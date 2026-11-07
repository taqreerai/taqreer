// POST /api/stripe/checkout
//
// Creates a Stripe-hosted Checkout Session and returns its URL. Two
// modes, both keyed by the catalog's stable `lookupKey` (the client
// never sends a Stripe Price id):
//
//   { lookupKey: "tier_pro_monthly" }  → subscription checkout
//   { lookupKey: "topup_small" }       → one-time top-up
//   { projectId: "<deck id>" }          → one-time unlock of THAT deck
//     (2026-10-08): the server picks the $4.99 / $5.99 / $6.99 price from
//     the deck's own size; the client never names the bracket.
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

import { isRegionLimitedFree } from "@/lib/credits/region-model";
import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/billing/stripe";
import { specByLookupKey, grantToMetadata } from "@/lib/billing/prices";
import { getOrCreateStripeCustomer } from "@/lib/billing/customer";
import { isPaidPlan, normalizePlan } from "@/lib/plan";
import {
  bracketForSlides,
  deckUnlockLookupKey,
  teaserBuiltFromPrompt,
  teaserTotalSlides,
} from "@/lib/billing/deck-unlock-brackets";
import { captureServerEvent } from "@/lib/analytics/posthog-server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  const limited = rateLimited(`checkout:${clientIp(request)}`, 15, 10 * 60_000);
  if (limited) return limited;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    lookupKey?: string;
    projectId?: unknown;
    surface?: unknown;
  } | null;

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, email: true, name: true, plan: true, role: true, signupCountry: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One-time deck unlock: resolve the deck (the caller's own, still locked,
  // not bought yet) and its size bracket server-side.
  let deckProjectId: string | null = null;
  let spec = body?.lookupKey ? specByLookupKey(body.lookupKey) : undefined;
  if (typeof body?.projectId === "string" && body.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: {
        id: true,
        userId: true,
        type: true,
        teaserLockedCount: true,
        teaserUnlockedAt: true,
        purchasedAt: true,
        aiPrompt: true,
      },
    });
    if (!project || project.userId !== dbUser.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (
      project.teaserLockedCount <= 0 ||
      project.teaserUnlockedAt != null ||
      project.purchasedAt != null
    ) {
      return NextResponse.json({ error: "already_unlocked" }, { status: 409 });
    }
    // Subscribers and admins unlock for free from the studio.
    if (isPaidPlan(dbUser.plan) || dbUser.role === "admin") {
      return NextResponse.json({ error: "already_entitled" }, { status: 409 });
    }
    const bracket = bracketForSlides(
      teaserTotalSlides(
        project.type,
        project.teaserLockedCount,
        teaserBuiltFromPrompt(project.aiPrompt),
      ),
    );
    if (!bracket) {
      return NextResponse.json({ error: "subscription_required" }, { status: 400 });
    }
    // Region-limited free accounts pay the regional price (region-model).
    spec = specByLookupKey(deckUnlockLookupKey(bracket, isRegionLimitedFree(dbUser)));
    deckProjectId = project.id;
  } else if (spec?.grant.kind === "deck_unlock") {
    // A deck unlock price is only sold against a specific deck.
    return NextResponse.json({ error: "Unknown price" }, { status: 400 });
  }
  if (!spec) {
    return NextResponse.json({ error: "Unknown price" }, { status: 400 });
  }
  const sessionMetadata: Record<string, string> = {
    prismaUserId: dbUser.id,
    ...grantToMetadata(spec.grant),
    ...(deckProjectId ? { projectId: deckProjectId } : {}),
  };

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
    metadata: sessionMetadata,
    ...(isSubscription
      ? {}
      : {
          payment_intent_data: {
            metadata: sessionMetadata,
          },
          // Post-payment invoice (proof of payment) so a top-up gets a real
          // invoice number + PDF, is listed on /invoices, and the receipt
          // email can link it. Stripe fee: 0.4% of the total, capped at $2
          // per invoice. It carries no subscription, so the
          // invoice.payment_succeeded renewal handler ignores it.
          invoice_creation: { enabled: true },
        }),
    // A deck unlock that needed a redirect (3-D Secure etc.) lands back on
    // the deck, where the unlock is already running; everything else on the
    // checkout return page.
    return_url: deckProjectId
      ? `${APP_URL}/project/${encodeURIComponent(deckProjectId)}`
      : `${APP_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    // Promo codes: YEARLY subscriptions only (user direction 2026-07-07).
    // Yearly list prices are $7 / $16 / $50 a month (2026-10-02, 22% / 16% /
    // 15% off monthly); the campaign coupon is a round 10% off on top
    // (~30% / 24% / 24% total). Codes are created in the Stripe dashboard,
    // not seeded: coupon percent_off = 10, duration = "once" (first year
    // only; renewals bill the yearly list price), attach a promotion code
    // (the shareable string).
    // Monthly + top-up sessions never show a promo field, so a yearly
    // coupon can't be redeemed against a monthly price.
    allow_promotion_codes:
      spec.grant.kind === "subscription" && spec.grant.cadence === "yearly",
    // Let the user save the card for future payments: shows the opt-in checkbox
    // in the Payment Element AND auto-redisplays the saved card on the next
    // checkout (1-click). Needs a customer (set above). Works in both modes; a
    // subscription already stores the card for renewals, this just makes it
    // explicit + reusable for top-ups / plan changes.
    saved_payment_method_options: { payment_method_save: "enabled" },
  });

  // Conversion funnel: a checkout was opened, with the cadence + the surface
  // (the pricing/plans page defaults to yearly, the upgrade modal to monthly;
  // 2026-10-02). Pairs with the webhook's purchase_completed (which carries
  // the cadence) to compare revenue per visitor by default. Best-effort.
  captureServerEvent(user.id, "checkout_started", {
    kind: spec.grant.kind,
    bracket: spec.grant.kind === "deck_unlock" ? spec.grant.bracket : undefined,
    plan: spec.grant.kind === "subscription" ? spec.grant.plan : undefined,
    cadence: spec.grant.kind === "subscription" ? spec.grant.cadence : undefined,
    surface: body?.surface === "modal" ? "modal" : "page",
  });

  return NextResponse.json({ clientSecret: session.client_secret });
}
