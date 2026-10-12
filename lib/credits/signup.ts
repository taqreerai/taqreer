// Signup-grant gate (billing plan §2 / gap #1 cheap layer). Runs four
// abuse guards the ledger itself can't see. The cross-account guards read
// then grant, so they run INSIDE grantSignupCreditsGuarded's serialized
// transaction, behind advisory locks on the collision keys (IP / inbox /
// device): two concurrent signups sharing a key run one-after-another, so
// the second sees the first's committed grant instead of racing past a
// stale read. The guards:
//
//   1. EMAIL-ALIAS DEDUPE - gmail dots and +suffixes make infinite
//      "different" addresses for one inbox. If ANOTHER user whose
//      normalized email matches has already received the signup grant,
//      this account gets 0 (and an audit event), so alias farming
//      yields exactly one grant per real inbox.
//   2. IP VELOCITY - more than 3 signup grants from one IP in 24h is
//      farming, not a household; further grants from that IP are
//      blocked (audit event, no grant).
//   3. SAME-PERSON (IP + NAME) - the other guards each miss a determined
//      duplicate who pairs a fresh inbox with a second browser and is only
//      the 2nd signup from the IP. What still links them is the human: same
//      signup IP + same real name. Block when a prior GRANTED account from
//      this exact IP carries a matching normalized name. Names with fewer
//      than two tokens are ignored (a lone first name is too weak to
//      identify a person), so a differently-named housemate on the same
//      router still gets credits.
//   4. DEVICE DEDUPE - one grant per browser, ever, keyed on the
//      middleware-minted `tq_did` cookie (lib/device-cookie.ts). Catches
//      the wifi-to-mobile-data hop the IP guard can't. A grant attempt with
//      NO device cookie is blocked fail-closed BEFORE the serialized section
//      (a cookie-less grant is a non-browser client); a legit race
//      self-heals because the grant re-attempts on the next sync/pageload
//      (blocks never stamp signupGrantedAt).
//
// Blocked accounts still work - they just start at 0 credits. Payment-
// method dedupe remains the stronger future layer (billing plan §8/§9).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { grantSignupCreditsGuarded } from "@/lib/credits/server";
import { applyReferralAtSignup } from "@/lib/referral";
import { isDisposableEmail } from "@/lib/auth/disposable-email";

const IP_VELOCITY_LIMIT = 3;
const IP_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;

// 5. COUNTRY BLOCK (2026-08-30, owner direction): signup-grant farming is
// overwhelmingly concentrated from these countries and they are outside
// the product's target market, so signups geolocated there get no free
// grant. The account itself still works (0 credits; paying is unaffected).
// Unknown/missing country (null) is NOT blocked, and CF's XX/T1 unknown
// sentinels pass sanitizeCountry but are not in the set - false positives
// hurt more than the occasional VPN evader this cheap layer misses.
// IR, SY, CU, KP (owner decision 2026-10-12): comprehensively sanctioned, so
// Stripe cannot take a payment there - free credits would never convert.
const GRANT_BLOCKED_COUNTRIES = new Set(["IN", "IR", "SY", "CU", "KP"]);

/**
 * Canonical inbox identity for alias detection. Lowercases; strips
 * one `+suffix` from the local part; for gmail/googlemail also strips
 * dots (gmail ignores them) and folds googlemail onto gmail.
 */
export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/**
 * Identity key for same-person detection. Lowercases, strips Arabic
 * tashkeel + tatweel and Latin combining accents, drops punctuation, and
 * token-SORTS so word order ("Rawan Abdulshafi" == "Abdulshafi Rawan")
 * doesn't matter. Returns null for names with fewer than two tokens - a
 * lone first name is too weak to identify a person and would false-block
 * a same-named housemate on the same router.
 */
export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Latin combining accents
    .replace(/[ـً-ْٰ]/g, "") // tatweel + Arabic harakat
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation -> space
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return tokens.sort().join(" ");
}

export async function maybeGrantSignupCredits(args: {
  userId: string;
  email: string;
  // Request IP (cf-connecting-ip chain) when available; null skips the
  // velocity + same-person guards rather than failing the signup.
  ip?: string | null;
  // Validated `tq_did` cookie (lib/device-cookie.ts). null/undefined =
  // absent or malformed, which BLOCKS the grant (see header comment).
  deviceId?: string | null;
  // Display name (Supabase user_metadata). Feeds the same-person guard;
  // null / single-token names skip it (see normalizeName).
  name?: string | null;
  // Audit-trail extras for the grant event metadata.
  geo?: { country: string | null; city: string | null };
  // Raw `tq_ref` invite-code cookie (lib/referral-code.ts). Applied only
  // AFTER this signup grant lands, so a farming-blocked account gets no
  // invite bonus either (lib/referral.ts).
  referralCode?: string | null;
}): Promise<{
  granted: number;
  blocked: BlockReason | null;
}> {
  const normalized = normalizeEmail(args.email);
  const at = normalized.lastIndexOf("@");
  const domain = at > 0 ? normalized.slice(at + 1) : null;
  const selfName = normalizeName(args.name);

  // Device cookie must be present (fail-closed, self-healing - see header
  // comment). A pure cookie-presence check: no DB, no cross-user race, so
  // reject here before opening the guarded transaction.
  if (!args.deviceId) {
    await prisma.usageEvent.create({
      data: {
        userId: args.userId,
        eventType: "credit.signup.blocked",
        amount: 0,
        metadata: {
          reason: "device_missing",
          ...(args.ip ? { ip: args.ip } : {}),
        },
      },
    });
    return { granted: 0, blocked: "device_missing" };
  }

  // Country block (guard 5) - like the device check, a pure input check:
  // no DB read, no cross-user race, so reject before the serialized
  // transaction. Null/unknown country passes (see GRANT_BLOCKED_COUNTRIES).
  const country = args.geo?.country ?? null;
  if (country && GRANT_BLOCKED_COUNTRIES.has(country)) {
    await prisma.usageEvent.create({
      data: {
        userId: args.userId,
        eventType: "credit.signup.blocked",
        amount: 0,
        metadata: {
          reason: "country_blocked",
          country,
          ...(args.ip ? { ip: args.ip } : {}),
        },
      },
    });
    return { granted: 0, blocked: "country_blocked" };
  }

  // Disposable inbox (guard 6, 2026-10-02): throwaway domains (mailinator,
  // temp-mail, ...) are the cheapest way past the alias + device guards, so
  // they get no grant. A pure input check like the two above. The signup
  // form already warns about these (POST /api/auth/email-check).
  if (isDisposableEmail(args.email)) {
    await prisma.usageEvent.create({
      data: {
        userId: args.userId,
        eventType: "credit.signup.blocked",
        amount: 0,
        metadata: {
          reason: "disposable_email",
          ...(domain ? { domain } : {}),
          ...(args.ip ? { ip: args.ip } : {}),
        },
      },
    });
    return { granted: 0, blocked: "disposable_email" };
  }

  // Capture the narrowed (non-null) device id in a const so it stays
  // `string` inside the guard closure below.
  const deviceId = args.deviceId;

  // Collision keys: any two concurrent signups that share an inbox, a
  // signup IP, or a device are serialized so each guard below observes the
  // other's committed grant instead of racing past a stale read.
  const lockKeys = [
    args.ip ? `signup:ip:${args.ip}` : null,
    domain ? `signup:email:${normalized}` : null,
    `signup:device:${deviceId}`,
  ].filter((k): k is string => k !== null);

  const result = await grantSignupCreditsGuarded<BlockReason>({
    userId: args.userId,
    lockKeys,
    metadata: {
      deviceId,
      ...(args.ip ? { ip: args.ip } : {}),
      ...(args.geo?.country ? { country: args.geo.country } : {}),
    },
    guard: (tx) => runSignupGuards(tx, args, normalized, domain, selfName, deviceId),
  });
  if (result.granted > 0 && args.referralCode) {
    await applyReferralAtSignup({ userId: args.userId, rawCode: args.referralCode });
  }
  return { granted: result.granted, blocked: result.blocked };
}

type BlockReason =
  | "email_alias"
  | "ip_velocity"
  | "device_dup"
  | "device_missing"
  | "same_person"
  | "country_blocked"
  | "disposable_email";

/**
 * The cross-account abuse guards, run INSIDE the serialized grant
 * transaction (so their reads are race-free - see grantSignupCreditsGuarded).
 * Returns the first block reason hit (and writes its audit event via `tx`),
 * or null to let the grant proceed. `deviceId` is guaranteed present here -
 * the device_missing fail-closed check happens before the transaction.
 */
async function runSignupGuards(
  tx: Prisma.TransactionClient,
  args: { userId: string; ip?: string | null },
  normalized: string,
  domain: string | null,
  selfName: string | null,
  deviceId: string,
): Promise<BlockReason | null> {
  // 1. Alias dedupe - another already-granted account on the same
  //    normalized inbox. Domain-scoped fetch + in-JS normalize (no
  //    normalized-email column yet; fine at current user counts).
  if (domain) {
    // gmail + googlemail are the same inbox space - search both.
    const domains =
      domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [domain];
    const candidates = await tx.user.findMany({
      where: {
        id: { not: args.userId },
        OR: domains.map((d) => ({
          email: { endsWith: `@${d}`, mode: "insensitive" as const },
        })),
      },
      select: { id: true, email: true, creditAccount: { select: { signupGrantedAt: true } } },
      take: 500,
    });
    const match = candidates.find(
      (u) =>
        u.creditAccount?.signupGrantedAt &&
        normalizeEmail(u.email) === normalized,
    );
    if (match) {
      await tx.usageEvent.create({
        data: {
          userId: args.userId,
          eventType: "credit.signup.blocked",
          amount: 0,
          metadata: { reason: "email_alias", matchedUserId: match.id },
        },
      });
      return "email_alias";
    }
  }

  // 2. IP velocity - cap grants per IP per 24h.
  if (args.ip) {
    const since = new Date(Date.now() - IP_VELOCITY_WINDOW_MS);
    const recent = await tx.usageEvent.count({
      where: {
        eventType: "credit.grant.signup",
        createdAt: { gte: since },
        metadata: { path: ["ip"], equals: args.ip },
      },
    });
    if (recent >= IP_VELOCITY_LIMIT) {
      await tx.usageEvent.create({
        data: {
          userId: args.userId,
          eventType: "credit.signup.blocked",
          amount: 0,
          metadata: { reason: "ip_velocity", ip: args.ip },
        },
      });
      return "ip_velocity";
    }
  }

  // 3. Same-person - a prior GRANTED account from this exact signup IP that
  //    carries a matching normalized name is the same human on a second
  //    inbox + browser (the combo that slips past the other guards).
  //    IP-scoped so two strangers who merely share a name never collide;
  //    name-gated (>= 2 tokens) so a differently-named housemate is spared.
  if (args.ip && selfName) {
    const sameIp = await tx.user.findMany({
      where: {
        id: { not: args.userId },
        signupIp: args.ip,
        name: { not: null },
        creditAccount: { is: { signupGrantedAt: { not: null } } },
      },
      select: { id: true, name: true },
      take: 500,
    });
    const twin = sameIp.find((u) => normalizeName(u.name) === selfName);
    if (twin) {
      await tx.usageEvent.create({
        data: {
          userId: args.userId,
          eventType: "credit.signup.blocked",
          amount: 0,
          metadata: { reason: "same_person", ip: args.ip, matchedUserId: twin.id },
        },
      });
      return "same_person";
    }
  }

  // 4. Device dedupe - one grant per `tq_did` browser id, ever.
  const priorFromDevice = await tx.usageEvent.count({
    where: {
      eventType: "credit.grant.signup",
      metadata: { path: ["deviceId"], equals: deviceId },
    },
  });
  if (priorFromDevice >= 1) {
    await tx.usageEvent.create({
      data: {
        userId: args.userId,
        eventType: "credit.signup.blocked",
        amount: 0,
        metadata: {
          reason: "device_dup",
          deviceId,
          ...(args.ip ? { ip: args.ip } : {}),
        },
      },
    });
    return "device_dup";
  }

  return null;
}
