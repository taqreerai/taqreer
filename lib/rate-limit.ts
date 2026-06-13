// Minimal in-memory per-key rate limiter (fixed window). Effective on our
// single-instance Hetzner deploy (one Node process); a redis-backed version is
// the Phase C upgrade for multi-instance. Not a security boundary on its own,
// a first-line abuse guard for public endpoints (e.g. the contact form).

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000; // safety cap; prune expired before growing past it.

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true, retryAfterMs: 0 };
}
