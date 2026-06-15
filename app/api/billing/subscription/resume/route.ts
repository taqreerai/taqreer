// POST /api/billing/subscription/resume - undo a scheduled cancel
// before the period ends (cancel_at_period_end back to false). The
// webhook mirrors the flip; we return the new state for optimistic UI.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { prisma } from "@/lib/prisma";
import { getBillingCaller } from "@/lib/billing/api-auth";
import { broadcastToUser } from "@/lib/realtime/server-broadcast";

export async function POST() {
  const caller = await getBillingCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!caller.subscriptionId) {
    return NextResponse.json({ error: "No subscription" }, { status: 400 });
  }

  const sub = await stripe.subscriptions.update(caller.subscriptionId, {
    cancel_at_period_end: false,
  });

  // Mirror NOW (don't wait for the webhook) so the caller's refetch reads the
  // resumed state instead of the stale pre-webhook value; webhook re-mirrors.
  await prisma.subscription
    .update({
      where: { userId: caller.userId },
      data: { cancelAtPeriodEnd: sub.cancel_at_period_end },
    })
    .catch(() => {});
  await broadcastToUser(caller.userId, "subscription.changed", {}).catch(
    () => {},
  );

  return NextResponse.json({
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
