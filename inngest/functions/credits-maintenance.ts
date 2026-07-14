// Daily credit-ledger janitor (billing plan Phase A). Three sweeps, all
// idempotent, all user-favorable:
//
//   1. STUCK HOLDS - a worker that died between hold and settle leaves
//      credits frozen. No legitimate generation runs 24h, so any hold
//      still "held" after that is released IN FULL (when in doubt,
//      refund). settleHold is idempotent - if the real settle somehow
//      raced in first, this is a no-op.
//   2. TOP-UP EXPIRY - zero out packs past their 12-month expiresAt.
//   3. COMP EXPIRY - revert users whose complimentary tier window
//      (User.planCompExpiresAt) has passed back to free (endCompTier).
//      Runs before the drip; comps carry a NULL allotmentResetAt so the
//      drip never touches them regardless, but reverting first keeps the
//      ordering honest.
//   4. MONTHLY DRIP - reset subscription allotments whose resetAt has
//      passed. Monthly Stripe subscribers reset via the renewal webhook
//      (Phase B); this cron is the trigger for YEARLY subscribers
//      (credits drip monthly, §8.2) and the webhook's safety net.

import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  endCompTier,
  expireTopups,
  resetMonthlyAllotment,
  settleHold,
} from "@/lib/credits/server";

const STUCK_HOLD_AGE_MS = 24 * 60 * 60 * 1000;

export const creditsMaintenance = inngest.createFunction(
  {
    id: "credits-maintenance",
    name: "Credits Maintenance (sweep + expiry + drip)",
    retries: 2,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step, logger }) => {
    const released = await step.run("release-stuck-holds", async () => {
      const cutoff = new Date(Date.now() - STUCK_HOLD_AGE_MS);
      const stuck = await prisma.creditHold.findMany({
        where: { status: "held", createdAt: { lt: cutoff } },
        select: { jobKey: true },
        take: 500,
      });
      let count = 0;
      for (const hold of stuck) {
        const result = await settleHold({
          jobKey: hold.jobKey,
          chargeAmount: 0,
          metadata: { status: "swept_stuck_hold" },
        });
        if (result.ok && !result.alreadySettled) count += 1;
      }
      return count;
    });

    const expired = await step.run("expire-topups", async () => {
      const now = new Date();
      const dueUsers = await prisma.topupGrant.findMany({
        where: { amountRemaining: { gt: 0 }, expiresAt: { lte: now } },
        select: { userId: true },
        distinct: ["userId"],
        take: 500,
      });
      let total = 0;
      for (const { userId } of dueUsers) {
        const result = await expireTopups({ userId });
        total += result.expired;
      }
      return { users: dueUsers.length, credits: total };
    });

    const compsReverted = await step.run("revert-expired-comps", async () => {
      const now = new Date();
      const due = await prisma.user.findMany({
        where: { planCompExpiresAt: { lte: now } },
        select: { id: true },
        take: 500,
      });
      let count = 0;
      for (const { id } of due) {
        await endCompTier({ userId: id });
        count += 1;
      }
      return count;
    });

    const reset = await step.run("monthly-drip", async () => {
      const now = new Date();
      const due = await prisma.creditAccount.findMany({
        where: { allotmentResetAt: { lte: now }, monthlyAllotment: { gt: 0 } },
        select: { userId: true },
        take: 500,
      });
      let count = 0;
      for (const { userId } of due) {
        const result = await resetMonthlyAllotment({ userId });
        if (result.reset) count += 1;
      }
      return count;
    });

    logger.info("credits_maintenance_done", {
      released,
      expired,
      compsReverted,
      reset,
    });
    return { released, expired, compsReverted, reset };
  },
);
