// Cloudflare edge-cache purge (purge-by-URL).
//
// Next's revalidateTag / revalidatePath only bust the SERVER cache. When the
// app sits behind Cloudflare (prod), the edge keeps serving its cached HTML
// until s-maxage expires (24h on the landing), so an on-demand revalidation
// never reaches visitors. The Next docs prescribe the fix: revalidate the
// server cache, then purge the CDN for the affected URLs. This is that purge.
//
// Best-effort and fail-soft: it NO-OPS (returns quietly) when the credentials
// are unset, so local dev and any not-yet-configured environment are
// unaffected, and a CDN hiccup is logged but never thrown so it cannot break
// the admin write that triggered it.
//
// Setup (prod only): create a Cloudflare API token scoped to Zone > Cache
// Purge for the taqreer.ai zone, then set in the prod env:
//   CLOUDFLARE_ZONE_ID    = the taqreer.ai zone id (Cloudflare dashboard)
//   CLOUDFLARE_PURGE_TOKEN = that token

const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const PURGE_TOKEN = process.env.CLOUDFLARE_PURGE_TOKEN;

// The public origin the cached URLs live on (the Cloudflare zone). Same env the
// rest of the app uses for canonical links; defaults to the prod domain.
function publicOrigin(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  // Normalize to the bare origin (scheme + host) so a configured value that
  // carries a path or trailing slash can't yield wrong purge targets.
  try {
    return new URL(fromEnv ?? "https://taqreer.ai").origin;
  } catch {
    return "https://taqreer.ai";
  }
}

// Cloudflare's purge-by-URL endpoint accepts at most 30 files per request;
// larger lists must be split or the whole call 400s and purges nothing.
const PURGE_BATCH_SIZE = 30;

// Purge the given same-origin paths (e.g. "/ar", "/en/presentation-templates")
// from the Cloudflare edge cache. Returns when done (or immediately when
// unconfigured); never throws. Lists longer than the API's 30-file cap are
// purged in sequential batches.
export async function purgeCloudflarePaths(paths: string[]): Promise<void> {
  if (!ZONE_ID || !PURGE_TOKEN) return; // unconfigured -> no-op (dev / pre-setup)
  if (paths.length === 0) return;

  const origin = publicOrigin();
  const files = paths.map(
    (p) => origin + (p.startsWith("/") ? p : "/" + p),
  );

  // Batches fire CONCURRENTLY: the admin/API write awaiting this must pay one
  // 5 s worst case, not 5 s per batch (a large slug set could otherwise push
  // the write toward its own timeout). Each batch is independently fail-soft.
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += PURGE_BATCH_SIZE) {
    batches.push(files.slice(i, i + PURGE_BATCH_SIZE));
  }
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${PURGE_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ files: batch }),
            // A slow CDN must not hang the admin write that awaits this.
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`[cf-purge] HTTP ${res.status}`, detail.slice(0, 300));
        }
      } catch (err) {
        console.error("[cf-purge] request failed", err);
      }
    }),
  );
}

// Purge the ENTIRE zone cache. Used after a DEPLOY: a new build changes every
// hashed JS/CSS chunk filename, so any HTML still cached at the edge points at
// old chunks that 404 after the atomic swap -> the page loads without
// hydration (static HTML, no animations). Per-URL purging can't cover that (the
// stale HTML lives at many URLs + references many chunks), so we purge
// everything and let CF refetch fresh. Logs (vs the silent per-URL no-op)
// because it runs once per deploy and the deploy output should show it ran.
export async function purgeCloudflareEverything(): Promise<void> {
  if (!ZONE_ID || !PURGE_TOKEN) {
    console.log(
      "[cf-purge] purge_everything skipped (CLOUDFLARE_ZONE_ID / CLOUDFLARE_PURGE_TOKEN unset)",
    );
    return;
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PURGE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ purge_everything: true }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[cf-purge] purge_everything HTTP ${res.status}`,
        detail.slice(0, 300),
      );
    } else {
      console.log("[cf-purge] purge_everything OK");
    }
  } catch (err) {
    console.error("[cf-purge] purge_everything request failed", err);
  }
}
