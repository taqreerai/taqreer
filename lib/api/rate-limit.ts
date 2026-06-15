// HTTP rate-limit helpers for API routes, built on the in-memory limiter
// (lib/rate-limit.ts). On the single-process Hetzner deploy this is an adequate
// first-line abuse guard (per-process, resets on reload); a redis-backed
// version is the future multi-instance upgrade. Key by IP at the TOP of a
// handler so floods are rejected cheaply, before the auth / DB / Puppeteer work.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

/** First IP from x-forwarded-for (nginx sets it), falling back to x-real-ip. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
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
