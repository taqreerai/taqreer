// POST /api/stripe/portal
//
// Opens the Stripe-hosted Customer Portal for the signed-in user and
// returns its URL. The portal is deliberately RESTRICTED (billing plan
// §8.3): cancel + update-payment-method + invoice history ONLY. Plan
// switching stays on our own pricing page so we own the up/downgrade
// messaging - so `subscription_update` is left disabled in the config.
//
// The restricted configuration is created once (find-or-create by a
// metadata tag) and reused.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/billing/stripe";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const CONFIG_TAG = "taqreer-restricted-v1";

let cachedConfigId: string | null = null;

async function getRestrictedPortalConfigId(): Promise<string> {
  if (cachedConfigId) return cachedConfigId;
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const found = existing.data.find(
    (c) => c.metadata?.taqreerConfig === CONFIG_TAG,
  );
  if (found) {
    cachedConfigId = found.id;
    return found.id;
  }
  const created = await stripe.billingPortal.configurations.create({
    metadata: { taqreerConfig: CONFIG_TAG },
    business_profile: {
      headline: "taqreer.ai billing",
    },
    features: {
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      // Plan switching stays OFF - handled on our pricing page.
      subscription_update: { enabled: false },
    },
  });
  cachedConfigId = created.id;
  return created.id;
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { user: { supabaseUserId: user.id } },
    select: { stripeCustomerId: true },
  });
  if (!sub?.stripeCustomerId) {
    // No Stripe customer yet = nothing to manage (never paid).
    return NextResponse.json(
      { error: "No billing account yet" },
      { status: 400 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    configuration: await getRestrictedPortalConfigId(),
    return_url: `${APP_URL}/settings`,
  });
  return NextResponse.json({ url: session.url });
}
