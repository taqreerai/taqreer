// POST /api/billing/subscription/cancel - schedule the caller's
// subscription to end at period end (never immediate; access runs to
// the paid-through date, per the billing plan). The webhook's
// customer.subscription.updated mirrors cancelAtPeriodEnd into our DB;
// we also return the new state for optimistic UI.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { getBillingCaller } from "@/lib/billing/api-auth";

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

  return NextResponse.json({
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
