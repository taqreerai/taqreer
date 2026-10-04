// Invite-a-colleague: edge-safe constants shared by the proxy (which captures
// `?ref=CODE` into a cookie) and the server logic in lib/referral.ts.

export const REFERRAL_COOKIE = "tq_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Codes are minted as 8 chars from an unambiguous alphabet (no 0/O/1/I/L).
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Normalizes a raw `ref` value to a valid code, or null. */
export function parseReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}
