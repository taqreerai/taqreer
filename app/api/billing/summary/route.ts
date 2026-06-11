// GET /api/billing/summary - the Settings Billing section's data: the
// user's current plan + the Stripe-mirrored subscription state (status,
// cadence, renewal/cancel dates). Read-only; the mirror is written only
// by the Stripe webhook.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plan";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, plan: true, subscriptions: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = dbUser.subscriptions[0] ?? null;
  return NextResponse.json({
    plan: normalizePlan(dbUser.plan),
    hasBillingAccount: !!sub?.stripeCustomerId,
    // active | past_due | canceled - drives the dunning banner.
    status: sub?.status ?? "active",
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
  });
}
