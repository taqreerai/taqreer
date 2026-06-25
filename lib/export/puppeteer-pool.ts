// Shared, hardened Puppeteer launch path for the server-side renderers
// (PDF + PNG export routes and the thumbnail Inngest job, all of which run
// in this Next process). Two purposes:
//
//   1. CONCURRENCY CAP: each Chromium is hundreds of MB and the box also
//      runs `next start`. The export routes have no global cap (only per-IP
//      rate limits), so a burst of concurrent exports could OOM the whole
//      app. A process-wide semaphore bounds live Chromium instances.
//
//   2. EGRESS ALLOWLIST: authored slide HTML can embed <img src> / CSS
//      url() pointing at private, link-local, loopback, or cloud-metadata
//      hosts; setContent renders it server-side, which makes Puppeteer an
//      SSRF vector. We intercept every request and allow only Google Fonts
//      plus the Supabase asset host (everything a deck legitimately
//      references), plus inline data:/blob: URIs. Everything else is
//      aborted. An allowlist needs no per-request DNS resolution, so it
//      also dodges DNS-rebinding, and it mirrors the sanitizer's existing
//      font allowlist so it does not block legitimate fetches.
//
// NOTE: `--no-sandbox` is retained deliberately. Dropping it only helps if
// the host's Chromium user-namespace sandbox is configured; removing it
// blind would break all rendering. Revisit as a box-verified change.

import puppeteer, { type Browser, type Page } from "puppeteer";

const MAX_CONCURRENT = 2;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot to the next waiter; active unchanged
  else active = Math.max(0, active - 1);
}

const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"];

// Launch Chromium gated by the process-wide concurrency cap. Pair every
// successful call with closeGuardedBrowser() so the slot is released.
export async function launchGuardedBrowser(): Promise<Browser> {
  await acquire();
  try {
    return await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  } catch (err) {
    release(); // launch failed, never closed, so release the slot here
    throw err;
  }
}

// Close the browser and release its concurrency slot. Always releases, even
// if close() throws.
export async function closeGuardedBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } finally {
    release();
  }
}

let cachedSupabaseHost: string | null = null;
function supabaseHost(): string {
  if (cachedSupabaseHost === null) {
    try {
      cachedSupabaseHost = new URL(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      ).hostname.toLowerCase();
    } catch {
      cachedSupabaseHost = "";
    }
  }
  return cachedSupabaseHost;
}

function isAllowedRequestUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // Inline content; no network fetch happens.
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  // HTTPS to known hosts only. Blocks http:, file:, ftp:, etc.
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "fonts.googleapis.com" || host === "fonts.gstatic.com") {
    return true;
  }
  const supa = supabaseHost();
  return supa !== "" && host === supa;
}

// Intercept every request the rendered page makes and abort anything
// outside the allowlist (the SSRF guard). MUST be called before setContent.
export async function guardPageEgress(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const decision = isAllowedRequestUrl(req.url())
      ? req.continue()
      : req.abort();
    // continue()/abort() return void on older Puppeteer, a Promise on newer;
    // normalize so a stray rejection can't crash the process.
    Promise.resolve(decision).catch(() => {});
  });
}
