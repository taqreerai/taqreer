// Invite-a-colleague credits (2026-10-04, owner decision).
//
//   - Every user has an invite link: /{lang}/signup?ref=CODE. The proxy keeps
//     the code in the `tq_ref` cookie for 30 days (lib/referral-code.ts).
//   - The INVITEE gets INVITEE_BONUS credits, but only from inside
//     maybeGrantSignupCredits AFTER their normal signup grant landed, so an
//     account the farming guards blocked (alias / IP / device / same person)
//     gets no invite bonus either.
//   - The INVITER gets INVITER_REWARD credits when the invitee completes their
//     FIRST paid subscription checkout (Stripe webhook): real money has to
//     change hands, so the reward can't be farmed with fake accounts. Capped
//     at MONTHLY_REWARD_CAP rewards per inviter per calendar month.
//
// Both grants are top-up grants (12-month expiry) with deterministic
// sourceKeys, so webhook retries and racing syncs can't double-grant.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { grantTopup } from "@/lib/credits/server";
import { REFERRAL_CODE_ALPHABET, parseReferralCode } from "@/lib/referral-code";

export const INVITEE_BONUS = 400;
export const INVITER_REWARD = 2000;
export const MONTHLY_REWARD_CAP = 10;

function mintCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => REFERRAL_CODE_ALPHABET[b % REFERRAL_CODE_ALPHABET.length]).join("");
}

/** This user's invite code, minted on first request. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    try {
      // Only set when still empty, so two racing requests keep one code.
      const res = await prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: code },
      });
      if (res.count === 1) return code;
      const now = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (now?.referralCode) return now.referralCode;
    } catch (err) {
      // Unique collision on the code itself: try another.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("[referral] could not mint a unique code");
}

/**
 * Called once a NEW user's signup grant has landed. Links them to the
 * inviter named by the cookie code and grants the invitee bonus. Never
 * throws: a bad code or any failure just means no bonus.
 */
export async function applyReferralAtSignup(args: {
  userId: string;
  rawCode: string | null | undefined;
}): Promise<{ granted: number }> {
  const code = parseReferralCode(args.rawCode);
  if (!code) return { granted: 0 };
  try {
    const inviter = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true, bannedAt: true },
    });
    if (!inviter || inviter.id === args.userId || inviter.bannedAt) return { granted: 0 };
    // Link once: a user can only ever be referred by one inviter.
    const linked = await prisma.user.updateMany({
      where: { id: args.userId, referredById: null },
      data: { referredById: inviter.id },
    });
    if (linked.count !== 1) return { granted: 0 };
    const result = await grantTopup({
      userId: args.userId,
      credits: INVITEE_BONUS,
      sourceKey: `referral:invitee:${args.userId}`,
      reason: "referral_invitee_bonus",
    });
    return { granted: result.granted };
  } catch (err) {
    console.error(
      "[referral] invitee bonus failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { granted: 0 };
  }
}

/**
 * Called on a completed SUBSCRIPTION checkout. If the buyer was invited and
 * their inviter hasn't been rewarded for them yet, grant the inviter reward
 * (within the monthly cap). Idempotent: the invitee row is claimed with a
 * conditional update before granting, and the grant's sourceKey is unique.
 */
export async function rewardInviterOnFirstPayment(inviteeId: string): Promise<void> {
  const invitee = await prisma.user.findUnique({
    where: { id: inviteeId },
    select: { referredById: true, referralRewardedAt: true },
  });
  const inviterId = invitee?.referredById;
  if (!inviterId || invitee.referralRewardedAt) return;
  const inviter = await prisma.user.findUnique({
    where: { id: inviterId },
    select: { bannedAt: true },
  });
  if (!inviter || inviter.bannedAt) return;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rewardedThisMonth = await prisma.user.count({
    where: { referredById: inviterId, referralRewardedAt: { gte: monthStart } },
  });
  if (rewardedThisMonth >= MONTHLY_REWARD_CAP) return;

  const claimed = await prisma.user.updateMany({
    where: { id: inviteeId, referredById: inviterId, referralRewardedAt: null },
    data: { referralRewardedAt: now },
  });
  if (claimed.count !== 1) return;
  await grantTopup({
    userId: inviterId,
    credits: INVITER_REWARD,
    sourceKey: `referral:reward:${inviteeId}`,
    reason: "referral_inviter_reward",
  });
}

/** Numbers for the invite card. */
export async function referralStats(userId: string): Promise<{
  invited: number;
  rewarded: number;
}> {
  const [invited, rewarded] = await Promise.all([
    prisma.user.count({ where: { referredById: userId } }),
    prisma.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
  ]);
  return { invited, rewarded };
}
