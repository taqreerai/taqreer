// POST /api/billing/subscription/cancel - schedule the caller's
// subscription to end at period end (never immediate; access runs to
// the paid-through date, per the billing plan). The webhook's
// customer.subscription.updated mirrors cancelAtPeriodEnd into our DB;
// we also return the new state for optimistic UI.

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
    cancel_at_period_end: true,
  });

  // Mirror the flag into our DB NOW (don't wait for the async webhook) so the
  // caller's immediate /api/billing/summary refetch reads the new state, rather
  // than clobbering its optimistic update with the stale pre-webhook value
  // (the "cancel button stayed until refresh" bug). The webhook re-mirrors
  // idempotently.
  await prisma.subscription
    .update({
      where: { userId: caller.userId },
      data: { cancelAtPeriodEnd: sub.cancel_at_period_end },
    })
    .catch(() => {});
  // Nudge other tabs/surfaces to refetch the mirror in place.
  await broadcastToUser(caller.userId, "subscription.changed", {}).catch(
    () => {},
  );

  return NextResponse.json({
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
