// Anonymous device-id cookie (`tq_did`) backing the signup-grant device
// guard (lib/credits/signup.ts). The middleware (proxy.ts) mints a UUID for
// every cookie-less visitor, so by the time any grant path runs the cookie
// is set-or-present; a grant request WITHOUT it is a non-browser client or
// deliberate cookie stripping and is blocked (self-heals on the next
// request, which arrives with the cookie the middleware just set).
//
// Kept dependency-free (no next/headers, no prisma) so both the edge
// middleware and node route handlers can import it.

export const DEVICE_COOKIE = "tq_did";

// 365 days, comfortably under Chrome's 400-day Set-Cookie cap. Fixed window
// (set only when missing, no sliding renewal) - a yearly reset is fine for
// an abuse guard.
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict shape check. The value round-trips through an attacker-controlled
 * cookie into UsageEvent metadata and Prisma JSON-path queries, so anything
 * that isn't exactly a UUID is treated as absent (and the middleware issues
 * a fresh id).
 */
export function isValidDeviceId(
  value: string | undefined | null,
): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Validated device id from a cookie store, or null. Accepts both the
 * `next/headers` ReadonlyRequestCookies and `NextRequest["cookies"]`.
 */
export function deviceIdFromCookies(store: {
  get(name: string): { value: string } | undefined;
}): string | null {
  const raw = store.get(DEVICE_COOKIE)?.value;
  return isValidDeviceId(raw) ? raw : null;
}
