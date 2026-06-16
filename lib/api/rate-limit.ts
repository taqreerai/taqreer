// HTTP rate-limit helpers for API routes, built on the in-memory limiter
// (lib/rate-limit.ts). On the single-process Hetzner deploy this is an adequate
// first-line abuse guard (per-process, resets on reload); a redis-backed
// version is the future multi-instance upgrade. Key by IP at the TOP of a
// handler so floods are rejected cheaply, before the auth / DB / Puppeteer work.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The real client IP as a header value, or null when none is usable. The site
 * sits behind Cloudflare, so prefer `CF-Connecting-IP` (CF sets it to the true
 * client IP). Fall back to `X-Real-IP` (nginx -> $remote_addr) then the LAST
 * `X-Forwarded-For` hop; the FIRST XFF hops are client-spoofable. Returns null
 * so callers can SKIP per-IP logic rather than bucket everyone under a sentinel
 * (a constant IP silently collapses both rate-limit and signup-velocity
 * buckets - which is exactly the prod bug this fixes: every request was reading
 * the nginx/Cloudflare hop, not the user).
 *
 * NOTE: `CF-Connecting-IP` is only trustworthy if the origin refuses non-
 * Cloudflare traffic; pair this with nginx `real_ip` (set_real_ip_from <CF
 * ranges> + real_ip_header CF-Connecting-IP) so $remote_addr is the real IP too.
 *
 * Accepts anything with `.get()` so both a `Request`'s `Headers` and the
 * `next/headers` `ReadonlyHeaders` (Server Components) work.
 */
export function clientIpFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  return null;
}

/** A non-null IP key for rate-limit buckets ("unknown" when none is present). */
export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers) ?? "unknown";
}

/**
 * Apply a fixed-window limit to `key`. Returns a ready 429 response (with a
 * Retry-After header) when over the limit, or null to continue. Usage:
 *   const limited = rateLimited(`export:${clientIp(req)}`, 30, 5 * 60_000);
 *   if (limited) return limited;
 */
export function rateLimited(
  key: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const rl = rateLimit(key, limit, windowMs);
  if (rl.ok) return null;
  return NextResponse.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    },
  );
}
