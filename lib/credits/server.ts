// Credit ledger - server-only money gate (context/subscriptionmodel.md §7
// Phase 1). Every mutation runs inside ONE Prisma interactive transaction
// that first locks the user's CreditAccount row (SELECT … FOR UPDATE), so
// two concurrent generations can never both pass the balance check, and
// the bucket split (subscription vs top-ups) can never tear.
//
// Buckets + spend order:
//   1. subscriptionBalance - evaporates at the monthly reset, so it is
//      spent FIRST (user-favorable).
//   2. TopupGrant rows - spent soonest-expiring-first, survive resets,
//      die 12 months after purchase.
// Refunds return to the EXACT sources a hold took from (a refund must
// not convert expiring top-up credits into resettable subscription
// credits, or vice versa). Edge: a remainder refunded to a grant that
// expired while the job ran stays expired - top-ups die 12 months after
// purchase, period; expireTopups() sweeps whatever remains.
//
// Idempotency anchors:
//   hold/settle/release - CreditHold.jobKey (Inngest retries re-find the
//     hold instead of re-debiting; a second settle returns the first
//     outcome and moves no money).
//   top-up grants - TopupGrant.sourceKey (a replayed Stripe webhook /
//     sim grant can't double-credit).
//   signup grant - CreditAccount.signupGrantedAt (once, ever).
//   monthly reset - guarded by allotmentResetAt and advances it.
//
// `now` is injectable on every time-sensitive op so the simulation can
// time-travel through resets and expiries.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcastToUser } from "@/lib/realtime/server-broadcast";
import { normalizePlan } from "@/lib/plan";
import { TOPUP_EXPIRY_MONTHS } from "@/lib/credits/cost";
import {
  ensureFresh,
  getFreeCredits,
  getTier,
} from "@/lib/config/runtime-config";

type Tx = Prisma.TransactionClient;

export type BalanceSnapshot = {
  total: number;
  subscription: number;
  topup: number;
  monthlyAllotment: number;
  allotmentResetAt: Date | null;
};

export type HoldResult =
  | { ok: true; holdId: string; amountHeld: number; alreadyHeld: boolean }
  | { ok: false; reason: "insufficient"; balance: number; needed: number };

export type SettleResult = {
  ok: true;
  charged: number;
  refunded: number;
  alreadySettled: boolean;
};

const SERIALIZED = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  // Row locks on a hot account (many concurrent ops in the sim) can
  // queue past the 5 s default.
  timeout: 15_000,
} as const;

function addMonths(date: Date, months: number): Date {
  const out = new Date(date);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/** Lock the user's account row for the duration of the transaction. */
async function lockAccount(tx: Tx, userId: string): Promise<void> {
  // Upsert first so brand-new users have a row to lock. The upsert
  // itself takes a row lock on conflict, so this is race-safe.
  await tx.$executeRaw`
    INSERT INTO "CreditAccount" ("userId", "createdAt", "updatedAt")
    VALUES (${userId}, NOW(), NOW())
    ON CONFLICT ("userId") DO NOTHING`;
  await tx.$queryRaw`
    SELECT "userId" FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`;
}

async function snapshotInTx(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<BalanceSnapshot> {
  const account = await tx.creditAccount.findUnique({ where: { userId } });
  const topups = await tx.topupGrant.aggregate({
    where: { userId, amountRemaining: { gt: 0 }, expiresAt: { gt: now } },
    _sum: { amountRemaining: true },
  });
  const subscription = account?.subscriptionBalance ?? 0;
  const topup = topups._sum.amountRemaining ?? 0;
  return {
    total: subscription + topup,
    subscription,
    topup,
    monthlyAllotment: account?.monthlyAllotment ?? 0,
    allotmentResetAt: account?.allotmentResetAt ?? null,
  };
}

/** Spendable balance + bucket split. Read-only, no lock. */
export async function getBalance(
  userId: string,
  now: Date = new Date(),
): Promise<BalanceSnapshot> {
  return snapshotInTx(prisma, userId, now);
}

/**
 * Nudge the user's open tabs to refetch their balance. Fire-and-forget -
 * a missed broadcast only delays the UI until its next refetch. The
 * payload is deliberately EMPTY (pointer-only): the user topic is a
 * public broadcast channel, so the balance itself must only ever travel
 * over the auth-gated GET /api/credits.
 */
async function notifyBalance(userId: string, _now: Date, notify: boolean) {
  if (!notify) return;
  try {
    await broadcastToUser(userId, "credit.balance.changed", {});
  } catch (err) {
    console.warn("[credits] balance broadcast failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type TopupTake = { grantId: string; amount: number };

/**
 * Debit `amount` from the locked account: subscription bucket first,
 * then top-ups soonest-expiring-first. Returns the exact sources so a
 * later refund can reverse them. Caller MUST hold the account lock.
 */
async function takeFunds(
  tx: Tx,
  userId: string,
  amount: number,
  now: Date,
): Promise<
  | { ok: true; fromSubscription: number; topupTakes: TopupTake[] }
  | { ok: false; balance: number }
> {
  const account = await tx.creditAccount.findUniqueOrThrow({
    where: { userId },
  });
  const grants = await tx.topupGrant.findMany({
    where: { userId, amountRemaining: { gt: 0 }, expiresAt: { gt: now } },
    orderBy: { expiresAt: "asc" },
  });
  const topupTotal = grants.reduce((sum, g) => sum + g.amountRemaining, 0);
  const total = account.subscriptionBalance + topupTotal;
  if (total < amount) return { ok: false, balance: total };

  const fromSubscription = Math.min(account.subscriptionBalance, amount);
  if (fromSubscription > 0) {
    await tx.creditAccount.update({
      where: { userId },
      data: { subscriptionBalance: { decrement: fromSubscription } },
    });
  }
  let rest = amount - fromSubscription;
  const topupTakes: TopupTake[] = [];
  for (const grant of grants) {
    if (rest <= 0) break;
    const take = Math.min(rest, grant.amountRemaining);
    await tx.topupGrant.update({
      where: { id: grant.id },
      data: { amountRemaining: { decrement: take } },
    });
    topupTakes.push({ grantId: grant.id, amount: take });
    rest -= take;
  }
  return { ok: true, fromSubscription, topupTakes };
}

/**
 * Return funds to their exact sources. The charge is attributed to the
 * subscription portion first (so refunds preferentially restore
 * longer-lived top-up credits). Caller MUST hold the account lock.
 */
async function refundFunds(
  tx: Tx,
  userId: string,
  charge: number,
  fromSubscription: number,
  topupTakes: TopupTake[],
): Promise<void> {
  const chargeFromSub = Math.min(charge, fromSubscription);
  const refundToSub = fromSubscription - chargeFromSub;
  if (refundToSub > 0) {
    await tx.creditAccount.update({
      where: { userId },
      data: { subscriptionBalance: { increment: refundToSub } },
    });
  }
  // Remaining charge falls on the takes in their original (soonest-
  // expiring-first) order; everything past it flows back to its grant.
  let chargeLeft = charge - chargeFromSub;
  for (const take of topupTakes) {
    const charged = Math.min(chargeLeft, take.amount);
    chargeLeft -= charged;
    const giveBack = take.amount - charged;
    if (giveBack > 0) {
      await tx.topupGrant.update({
        where: { id: take.grantId },
        data: { amountRemaining: { increment: giveBack } },
      });
    }
  }
}

async function logEvent(
  tx: Tx,
  userId: string,
  eventType: string,
  amount: number,
  metadata: Prisma.InputJsonValue,
): Promise<void> {
  await tx.usageEvent.create({
    data: { userId, eventType, amount, metadata },
  });
}

/**
 * Pre-authorize a generation: debit the maximum the job may cost.
 * Idempotent per jobKey - a retry of the same job re-finds the hold
 * and debits nothing.
 */
export async function holdCredits(args: {
  userId: string;
  jobKey: string;
  amount: number;
  metadata?: Prisma.InputJsonValue;
  now?: Date;
  notify?: boolean;
  // Admin/superuser owner: skip billing entirely. No hold row, no
  // debit, no event. settleHold later finds no CreditHold and returns
  // not_found, which every caller already tolerates (the "legacy
  // uncharged job" path). One switch so no charge site can miss it.
  waive?: boolean;
}): Promise<HoldResult> {
  if (args.waive) {
    return { ok: true, holdId: "", amountHeld: 0, alreadyHeld: true };
  }
  const now = args.now ?? new Date();
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    throw new Error(`[credits] hold amount must be a positive integer, got ${args.amount}`);
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const existing = await tx.creditHold.findUnique({
      where: { jobKey: args.jobKey },
    });
    if (existing) {
      return {
        ok: true as const,
        holdId: existing.id,
        amountHeld: existing.amountHeld,
        alreadyHeld: true,
      };
    }
    const taken = await takeFunds(tx, args.userId, args.amount, now);
    if (!taken.ok) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        balance: taken.balance,
        needed: args.amount,
      };
    }
    const hold = await tx.creditHold.create({
      data: {
        userId: args.userId,
        jobKey: args.jobKey,
        amountHeld: args.amount,
        fromSubscription: taken.fromSubscription,
        topupTakes: taken.topupTakes,
        metadata: args.metadata,
      },
    });
    await logEvent(tx, args.userId, "credit.hold", -args.amount, {
      jobKey: args.jobKey,
      holdId: hold.id,
      ...(typeof args.metadata === "object" && args.metadata !== null
        ? (args.metadata as Record<string, unknown>)
        : {}),
    });
    return {
      ok: true as const,
      holdId: hold.id,
      amountHeld: args.amount,
      alreadyHeld: false,
    };
  }, SERIALIZED);

  if (result.ok && !result.alreadyHeld) {
    await notifyBalance(args.userId, now, args.notify ?? true);
  }
  return result;
}

/**
 * Finalize a hold: charge `chargeAmount` (CLAMPED to the held amount -
 * the user can never pay more than they were shown) and return the
 * remainder to its sources. charge 0 == full release (failure /
 * pre-emit cancel). Idempotent per jobKey.
 */
export async function settleHold(args: {
  jobKey: string;
  chargeAmount: number;
  metadata?: Prisma.InputJsonValue;
  now?: Date;
  notify?: boolean;
}): Promise<SettleResult | { ok: false; reason: "not_found" }> {
  const now = args.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const peek = await tx.creditHold.findUnique({
      where: { jobKey: args.jobKey },
    });
    if (!peek) return { ok: false as const, reason: "not_found" as const };
    await lockAccount(tx, peek.userId);
    // Re-read under the lock - a concurrent settle may have won.
    const hold = await tx.creditHold.findUniqueOrThrow({
      where: { jobKey: args.jobKey },
    });
    if (hold.status !== "held") {
      return {
        ok: true as const,
        charged: hold.amountCharged ?? hold.amountHeld,
        refunded: hold.amountHeld - (hold.amountCharged ?? hold.amountHeld),
        alreadySettled: true,
        userId: hold.userId,
      };
    }
    const charge = Math.max(0, Math.min(args.chargeAmount, hold.amountHeld));
    const refund = hold.amountHeld - charge;
    await refundFunds(
      tx,
      hold.userId,
      charge,
      hold.fromSubscription,
      (hold.topupTakes as TopupTake[] | null) ?? [],
    );
    await tx.creditHold.update({
      where: { id: hold.id },
      data: {
        status: charge > 0 ? "settled" : "released",
        amountCharged: charge,
      },
    });
    await logEvent(
      tx,
      hold.userId,
      charge > 0 ? "credit.settle" : "credit.release",
      refund,
      {
        jobKey: args.jobKey,
        holdId: hold.id,
        charged: charge,
        refunded: refund,
        ...(typeof args.metadata === "object" && args.metadata !== null
          ? (args.metadata as Record<string, unknown>)
          : {}),
      },
    );
    return {
      ok: true as const,
      charged: charge,
      refunded: refund,
      alreadySettled: false,
      userId: hold.userId,
    };
  }, SERIALIZED);

  if (result.ok && !result.alreadySettled) {
    await notifyBalance(result.userId, now, args.notify ?? true);
  }
  if (!result.ok) return result;
  const { userId: _userId, ...rest } = result;
  return rest;
}

/**
 * Immediate flat charge (regen, name-gen): debit + settled hold in one
 * transaction. Idempotent per chargeKey.
 */
export async function chargeCredits(args: {
  userId: string;
  chargeKey: string;
  amount: number;
  metadata?: Prisma.InputJsonValue;
  now?: Date;
  notify?: boolean;
  // Admin/superuser owner: skip billing (mirrors holdCredits.waive).
  waive?: boolean;
}): Promise<HoldResult> {
  if (args.waive) {
    return { ok: true, holdId: "", amountHeld: 0, alreadyHeld: true };
  }
  const now = args.now ?? new Date();
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    throw new Error(`[credits] charge amount must be a positive integer, got ${args.amount}`);
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const existing = await tx.creditHold.findUnique({
      where: { jobKey: args.chargeKey },
    });
    if (existing) {
      return {
        ok: true as const,
        holdId: existing.id,
        amountHeld: existing.amountHeld,
        alreadyHeld: true,
      };
    }
    const taken = await takeFunds(tx, args.userId, args.amount, now);
    if (!taken.ok) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        balance: taken.balance,
        needed: args.amount,
      };
    }
    const hold = await tx.creditHold.create({
      data: {
        userId: args.userId,
        jobKey: args.chargeKey,
        amountHeld: args.amount,
        amountCharged: args.amount,
        status: "settled",
        fromSubscription: taken.fromSubscription,
        topupTakes: taken.topupTakes,
        metadata: args.metadata,
      },
    });
    await logEvent(tx, args.userId, "credit.charge", -args.amount, {
      chargeKey: args.chargeKey,
      holdId: hold.id,
      ...(typeof args.metadata === "object" && args.metadata !== null
        ? (args.metadata as Record<string, unknown>)
        : {}),
    });
    return {
      ok: true as const,
      holdId: hold.id,
      amountHeld: args.amount,
      alreadyHeld: false,
    };
  }, SERIALIZED);

  if (result.ok && !result.alreadyHeld) {
    await notifyBalance(args.userId, now, args.notify ?? true);
  }
  return result;
}

/** One-time Free signup grant. Idempotent via signupGrantedAt. */
export async function grantSignupCredits(args: {
  userId: string;
  now?: Date;
  notify?: boolean;
  // Audit trail extras (e.g. the signup request IP for the velocity
  // guard in lib/credits/signup.ts).
  metadata?: Prisma.InputJsonValue;
}): Promise<{ granted: number; alreadyGranted: boolean }> {
  const now = args.now ?? new Date();
  await ensureFresh();
  const amount = getFreeCredits();
  const result = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { userId: args.userId },
    });
    if (account.signupGrantedAt) {
      return { granted: 0, alreadyGranted: true };
    }
    await tx.creditAccount.update({
      where: { userId: args.userId },
      data: {
        subscriptionBalance: { increment: amount },
        signupGrantedAt: now,
      },
    });
    await logEvent(
      tx,
      args.userId,
      "credit.grant.signup",
      amount,
      args.metadata ?? {},
    );
    return { granted: amount, alreadyGranted: false };
  }, SERIALIZED);
  if (!result.alreadyGranted) {
    await notifyBalance(args.userId, now, args.notify ?? true);
  }
  return result;
}

/**
 * Admin override: set the subscription bucket to an absolute value (the
 * clawback tool for farmed signup grants - target 0 empties it). Top-up
 * grants are untouched; zeroing those, if ever needed, is a separate
 * action. Logs `credit.admin.set` with amount = DELTA (keeps the ledger
 * invariant that summing UsageEvent.amount tracks balance movement);
 * the absolute before/after live in metadata.
 */
export async function setSubscriptionBalance(args: {
  userId: string;
  target: number;
  adminUserId: string;
  reason?: string;
  now?: Date;
  notify?: boolean;
}): Promise<BalanceSnapshot> {
  const now = args.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { userId: args.userId },
    });
    await tx.creditAccount.update({
      where: { userId: args.userId },
      data: { subscriptionBalance: args.target },
    });
    await logEvent(
      tx,
      args.userId,
      "credit.admin.set",
      args.target - account.subscriptionBalance,
      {
        previousSubscription: account.subscriptionBalance,
        newSubscription: args.target,
        adminUserId: args.adminUserId,
        ...(args.reason ? { reason: args.reason } : {}),
      },
    );
  }, SERIALIZED);
  await notifyBalance(args.userId, now, args.notify ?? true);
  return getBalance(args.userId, now);
}

/**
 * Apply a plan's cycle grant - used on purchase/upgrade (immediate new
 * allotment, paid now) and by the renewal path. Sets, not adds: the
 * subscription bucket becomes exactly the tier allotment (no rollover).
 * Top-ups are untouched. Downgrades go through changePlan() instead so
 * the already-granted balance stays spendable.
 */
export async function grantSubscriptionCycle(args: {
  userId: string;
  plan: string;
  periodEnd?: Date;
  now?: Date;
  notify?: boolean;
}): Promise<BalanceSnapshot> {
  const now = args.now ?? new Date();
  const plan = normalizePlan(args.plan);
  await ensureFresh();
  const tier = getTier(plan);
  const resetAt = args.periodEnd ?? addMonths(now, 1);
  await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { userId: args.userId },
    });
    await tx.creditAccount.update({
      where: { userId: args.userId },
      data: {
        subscriptionBalance: tier.monthlyAllotment,
        monthlyAllotment: tier.monthlyAllotment,
        allotmentResetAt: tier.monthlyAllotment > 0 ? resetAt : null,
      },
    });
    await tx.user.update({
      where: { id: args.userId },
      data: { plan },
    });
    await logEvent(
      tx,
      args.userId,
      "credit.grant.subscription",
      tier.monthlyAllotment - account.subscriptionBalance,
      { plan, allotment: tier.monthlyAllotment, resetAt: resetAt.toISOString() },
    );
  }, SERIALIZED);
  await notifyBalance(args.userId, now, args.notify ?? true);
  return getBalance(args.userId, now);
}

/**
 * Downgrade (or any plan change that must NOT touch the current
 * balance): the user keeps what they already have - remaining
 * subscription credits stay spendable until the cycle ends, top-ups
 * are untouched. Only the NEXT cycle's allotment changes.
 */
export async function changePlanKeepBalance(args: {
  userId: string;
  plan: string;
  now?: Date;
  notify?: boolean;
}): Promise<BalanceSnapshot> {
  const now = args.now ?? new Date();
  const plan = normalizePlan(args.plan);
  await ensureFresh();
  const tier = getTier(plan);
  await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    await tx.creditAccount.update({
      where: { userId: args.userId },
      data: { monthlyAllotment: tier.monthlyAllotment },
    });
    await tx.user.update({ where: { id: args.userId }, data: { plan } });
    await logEvent(tx, args.userId, "credit.plan.changed", 0, {
      plan,
      nextAllotment: tier.monthlyAllotment,
    });
  }, SERIALIZED);
  await notifyBalance(args.userId, now, args.notify ?? true);
  return getBalance(args.userId, now);
}

/**
 * Purchased top-up pack: stacks on the balance, survives monthly
 * resets, expires 12 months from purchase. Idempotent per sourceKey
 * (the Stripe event id once billing is live).
 */
export async function grantTopup(args: {
  userId: string;
  credits: number;
  sourceKey: string;
  now?: Date;
  notify?: boolean;
}): Promise<{ granted: number; alreadyGranted: boolean; expiresAt: Date }> {
  const now = args.now ?? new Date();
  if (!Number.isInteger(args.credits) || args.credits <= 0) {
    throw new Error(`[credits] top-up must be a positive integer, got ${args.credits}`);
  }
  const expiresAt = addMonths(now, TOPUP_EXPIRY_MONTHS);
  try {
    await prisma.$transaction(async (tx) => {
      await lockAccount(tx, args.userId);
      await tx.topupGrant.create({
        data: {
          userId: args.userId,
          amountGranted: args.credits,
          amountRemaining: args.credits,
          expiresAt,
          sourceKey: args.sourceKey,
        },
      });
      await logEvent(tx, args.userId, "credit.grant.topup", args.credits, {
        sourceKey: args.sourceKey,
        expiresAt: expiresAt.toISOString(),
      });
    }, SERIALIZED);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.topupGrant.findUnique({
        where: { sourceKey: args.sourceKey },
      });
      return {
        granted: 0,
        alreadyGranted: true,
        expiresAt: existing?.expiresAt ?? expiresAt,
      };
    }
    throw err;
  }
  await notifyBalance(args.userId, now, args.notify ?? true);
  return { granted: args.credits, alreadyGranted: false, expiresAt };
}

/**
 * Monthly reset: the subscription bucket snaps to the tier allotment
 * (unused credits do NOT roll over); top-ups are untouched. Idempotent -
 * only fires when `now` has crossed allotmentResetAt, and advances it.
 */
export async function resetMonthlyAllotment(args: {
  userId: string;
  now?: Date;
  notify?: boolean;
}): Promise<{ reset: boolean; snapshot: BalanceSnapshot }> {
  const now = args.now ?? new Date();
  const didReset = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const account = await tx.creditAccount.findUniqueOrThrow({
      where: { userId: args.userId },
    });
    if (!account.allotmentResetAt || now < account.allotmentResetAt) {
      return false;
    }
    // Catch up multiple missed cycles to one boundary past `now`.
    let nextReset = account.allotmentResetAt;
    while (nextReset <= now) nextReset = addMonths(nextReset, 1);
    await tx.creditAccount.update({
      where: { userId: args.userId },
      data: {
        subscriptionBalance: account.monthlyAllotment,
        allotmentResetAt: nextReset,
      },
    });
    await logEvent(
      tx,
      args.userId,
      "credit.reset",
      account.monthlyAllotment - account.subscriptionBalance,
      {
        allotment: account.monthlyAllotment,
        forfeited: Math.max(0, account.subscriptionBalance),
        nextResetAt: nextReset.toISOString(),
      },
    );
    return true;
  }, SERIALIZED);
  if (didReset) await notifyBalance(args.userId, now, args.notify ?? true);
  return { reset: didReset, snapshot: await getBalance(args.userId, now) };
}

/**
 * Zero out expired top-up grants (daily cron once live; called directly
 * by the sim). Idempotent - already-zeroed grants are skipped.
 */
export async function expireTopups(args: {
  userId: string;
  now?: Date;
  notify?: boolean;
}): Promise<{ expired: number }> {
  const now = args.now ?? new Date();
  const expired = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, args.userId);
    const stale = await tx.topupGrant.findMany({
      where: {
        userId: args.userId,
        amountRemaining: { gt: 0 },
        expiresAt: { lte: now },
      },
    });
    let total = 0;
    for (const grant of stale) {
      await tx.topupGrant.update({
        where: { id: grant.id },
        data: { amountRemaining: 0 },
      });
      await logEvent(
        tx,
        args.userId,
        "credit.expire_topup",
        -grant.amountRemaining,
        { grantId: grant.id, sourceKey: grant.sourceKey },
      );
      total += grant.amountRemaining;
    }
    return total;
  }, SERIALIZED);
  if (expired > 0) await notifyBalance(args.userId, now, args.notify ?? true);
  return { expired };
}
