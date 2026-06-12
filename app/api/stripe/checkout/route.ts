// POST /api/stripe/checkout
//
// Creates a Stripe-hosted Checkout Session and returns its URL. Two
// modes, both keyed by the catalog's stable `lookupKey` (the client
// never sends a Stripe Price id):
//
//   { lookupKey: "tier_pro_monthly" }  → subscription checkout
//   { lookupKey: "topup_small" }       → one-time top-up
//
// The grant is applied by the webhook (checkout.session.completed), not
// here - this route only opens the payment page. session metadata
// carries prismaUserId + the grant so the webhook is self-describing
// even if Stripe's expansion is thin.
//
// Plan SWITCHING also routes through here (our pricing page owns
// up/downgrade messaging; the portal's plan-switch is disabled). For a
// user with an existing subscription we still open a new subscription
// Checkout; Stripe handles proration on the resulting
// customer.subscription.updated.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/billing/stripe";
import { specByLookupKey, grantToMetadata } from "@/lib/billing/prices";
import { getOrCreateStripeCustomer } from "@/lib/billing/customer";
import { normalizePlan } from "@/lib/plan";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    lookupKey?: string;
    ctx?: string;
  } | null;
  const spec = body?.lookupKey ? specByLookupKey(body.lookupKey) : undefined;
  if (!spec) {
    return NextResponse.json({ error: "Unknown price" }, { status: 400 });
  }
  // ctx=tab: checkout opened in a fresh tab from the credit-gate
  // dialog; the return page then offers "close this tab" instead of
  // redirecting (the original tab keeps the user's flow state).
  const ctx = body?.ctx === "tab" ? "tab" : null;

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, email: true, name: true, plan: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Top-up packs REFILL a subscription - they are not sold to Free
  // accounts (user direction 2026-06-12: free users subscribe first).
  if (spec.grant.kind === "topup" && normalizePlan(dbUser.plan) === "free") {
    return NextResponse.json(
      { error: "topup_requires_subscription" },
      { status: 403 },
    );
  }

  const customerId = await getOrCreateStripeCustomer({
    prismaUserId: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
  });

  // Resolve the live Price id from the stable lookup_key (no Stripe ids
  // in client input or app code).
  const prices = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    return NextResponse.json(
      { error: "Price not configured in Stripe" },
      { status: 500 },
    );
  }

  const isSubscription = spec.grant.kind === "subscription";
  // ELEMENTS checkout (user direction 2026-06-12: fully custom form):
  // the session powers our OWN payment page at /checkout, built from
  // Payment Element components and themed via the Appearance API -
  // Arabic labels, our tokens, our layout. We return the session's
  // client_secret; on confirm Stripe redirects to return_url (the
  // {CHECKOUT_SESSION_ID} template lets the return page verify).
  const session = await stripe.checkout.sessions.create({
    ui_mode: "elements",
    mode: isSubscription ? "subscription" : "payment",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    // Self-describing metadata for the webhook (mirrored on the
    // PaymentIntent for one-time so a charge-only event can resolve it).
    metadata: { prismaUserId: dbUser.id, ...grantToMetadata(spec.grant) },
    ...(isSubscription
      ? {}
      : {
          payment_intent_data: {
            metadata: {
              prismaUserId: dbUser.id,
              ...grantToMetadata(spec.grant),
            },
          },
        }),
    return_url: `${APP_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}${ctx ? "&ctx=tab" : ""}`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ clientSecret: session.client_secret });
}
