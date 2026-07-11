// Goodwill / remediation refund - the ONE entrypoint that credits the
// account, rings the bell, and emails the user, together. Called by the
// auto-refund on a user-cancelled generation (deck-generate settle), by
// one-off admin remediations, and by any future goodwill credit.
//
// Idempotent by `refundKey`: the ledger refund is the source of truth, so
// a repeat with the same key credits nothing AND skips the bell + email
// (no double notification on an Inngest step retry).
//
// Fire-and-forget friendly: the bell + email never throw out of here (a
// mail/notification hiccup must never fail the caller's transaction path).

import { refundCredits, getBalance } from "@/lib/credits/server";
import { fanOutNotification } from "@/lib/notifications/server";
import { emailRefundCredits } from "@/lib/billing/receipt-email";
import type { Prisma } from "@prisma/client";

export async function refundAndNotify(args: {
  userId: string;
  credits: number;
  // Idempotency key - same key = the refund already happened, no-op.
  refundKey: string;
  reason: "cancelled" | "goodwill";
  metadata?: Prisma.InputJsonValue;
  // Send the email too (default true). The in-app bell always fires on a
  // fresh refund.
  email?: boolean;
}): Promise<{ refunded: number; alreadyRefunded: boolean }> {
  const res = await refundCredits({
    userId: args.userId,
    amount: args.credits,
    refundKey: args.refundKey,
    reason: args.reason,
    metadata: args.metadata,
  });
  // Already paid on a prior run: the balance broadcast + bell + email all
  // went out then - do nothing now.
  if (res.alreadyRefunded) return res;

  // Bell (account-scoped: sole recipient = the user, self-echo on).
  await fanOutNotification({
    type: "credit.refund",
    projectId: null,
    actorPrismaUserId: null,
    recipientUserIds: [args.userId],
    allowSelfEcho: true,
    payload: { credits: args.credits, reason: args.reason },
  }).catch(() => {
    /* fanOutNotification never throws, but belt-and-braces */
  });

  // Email (best-effort; the new balance rides the summary rows).
  if (args.email !== false) {
    try {
      const balance = await getBalance(args.userId);
      await emailRefundCredits(args.userId, {
        credits: args.credits,
        reason: args.reason,
        balance: balance.total,
      });
    } catch (err) {
      console.warn("[refund] email failed", {
        userId: args.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return res;
}
