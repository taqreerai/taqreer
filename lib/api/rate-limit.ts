// HTTP rate-limit helpers for API routes, built on the in-memory limiter
// (lib/rate-limit.ts). On the single-process Hetzner deploy this is an adequate
// first-line abuse guard (per-process, resets on reload); a redis-backed
// version is the future multi-instance upgrade. Key by IP at the TOP of a
// handler so floods are rejected cheaply, before the auth / DB / Puppeteer work.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The real client IP. nginx is configured to set `X-Real-IP` to `$remote_addr`
 * (the actual TCP peer, which a client cannot spoof) and to append the real IP
 * as the LAST `X-Forwarded-For` hop. Prefer `X-Real-IP`; fall back to the last
 * XFF hop, then "unknown". Do NOT trust the FIRST XFF hop, a client can prepend
 * arbitrary values there to evade a per-IP limit.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",");
    return hops[hops.length - 1]!.trim();
  }
  return "unknown";
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
