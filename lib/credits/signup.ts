// Signup-grant gate (billing plan §2 / gap #1 cheap layer). Wraps
// grantSignupCredits with the three abuse guards the ledger itself can't
// see:
//
//   1. EMAIL-ALIAS DEDUPE - gmail dots and +suffixes make infinite
//      "different" addresses for one inbox. If ANOTHER user whose
//      normalized email matches has already received the signup grant,
//      this account gets 0 (and an audit event), so alias farming
//      yields exactly one grant per real inbox.
//   2. IP VELOCITY - more than 3 signup grants from one IP in 24h is
//      farming, not a household; further grants from that IP are
//      blocked (audit event, no grant).
//   3. DEVICE DEDUPE - one grant per browser, ever, keyed on the
//      middleware-minted `tq_did` cookie (lib/device-cookie.ts). Catches
//      the wifi-to-mobile-data hop the IP guard can't. A grant attempt
//      with NO device cookie is blocked fail-closed: the middleware sets
//      the cookie on every matched request, so a cookie-less grant is a
//      non-browser client, and a legit race self-heals because the grant
//      re-attempts on the next sync/pageload (blocks never stamp
//      signupGrantedAt).
//
// Blocked accounts still work - they just start at 0 credits. Payment-
// method dedupe remains the stronger future layer (billing plan §8/§9).

import { prisma } from "@/lib/prisma";
import { grantSignupCredits } from "@/lib/credits/server";

const IP_VELOCITY_LIMIT = 3;
const IP_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export async function maybeGrantSignupCredits(args: {
  userId: string;
  email: string;
  // Request IP (cf-connecting-ip chain) when available; null skips the
  // velocity guard rather than failing the signup.
  ip?: string | null;
  // Validated `tq_did` cookie (lib/device-cookie.ts). null/undefined =
  // absent or malformed, which BLOCKS the grant (see header comment).
  deviceId?: string | null;
  // Audit-trail extras for the grant event metadata.
  geo?: { country: string | null; city: string | null };
}): Promise<{
  granted: number;
  blocked: "email_alias" | "ip_velocity" | "device_dup" | "device_missing" | null;
}> {
  const normalized = normalizeEmail(args.email);
  const at = normalized.lastIndexOf("@");
  const domain = at > 0 ? normalized.slice(at + 1) : null;

  // 1. Alias dedupe - look for another already-granted account on the
  //    same normalized inbox. Domain-scoped fetch + in-JS normalize
  //    (no normalized-email column yet; fine at current user counts,
  //    revisit with an indexed column if the table grows).
  if (domain) {
    // gmail + googlemail are the same inbox space - search both.
    const domains =
      domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [domain];
    const candidates = await prisma.user.findMany({
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
      await prisma.usageEvent.create({
        data: {
          userId: args.userId,
          eventType: "credit.signup.blocked",
          amount: 0,
          metadata: { reason: "email_alias", matchedUserId: match.id },
        },
      });
      return { granted: 0, blocked: "email_alias" };
    }
  }

  // 2. IP velocity - cap grants per IP per 24h.
  if (args.ip) {
    const since = new Date(Date.now() - IP_VELOCITY_WINDOW_MS);
    const recent = await prisma.usageEvent.count({
      where: {
        eventType: "credit.grant.signup",
        createdAt: { gte: since },
        metadata: { path: ["ip"], equals: args.ip },
      },
    });
    if (recent >= IP_VELOCITY_LIMIT) {
      await prisma.usageEvent.create({
        data: {
          userId: args.userId,
          eventType: "credit.signup.blocked",
          amount: 0,
          metadata: { reason: "ip_velocity", ip: args.ip },
        },
      });
      return { granted: 0, blocked: "ip_velocity" };
    }
  }

  // 3. Device dedupe - one grant per `tq_did` browser id, ever; no cookie,
  //    no grant (fail-closed, self-healing - see header comment).
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
  const priorFromDevice = await prisma.usageEvent.count({
    where: {
      eventType: "credit.grant.signup",
      metadata: { path: ["deviceId"], equals: args.deviceId },
    },
  });
  if (priorFromDevice >= 1) {
    await prisma.usageEvent.create({
      data: {
        userId: args.userId,
        eventType: "credit.signup.blocked",
        amount: 0,
        metadata: {
          reason: "device_dup",
          deviceId: args.deviceId,
          ...(args.ip ? { ip: args.ip } : {}),
        },
      },
    });
    return { granted: 0, blocked: "device_dup" };
  }

  const result = await grantSignupCredits({
    userId: args.userId,
    metadata: {
      deviceId: args.deviceId,
      ...(args.ip ? { ip: args.ip } : {}),
      ...(args.geo?.country ? { country: args.geo.country } : {}),
    },
  });
  return { granted: result.granted, blocked: null };
}
