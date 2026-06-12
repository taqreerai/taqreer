// POST /api/billing/payment-methods/setup-intent - mints a SetupIntent
// client secret for the /billing add-card form (PaymentElement, same
// Appearance as checkout). `usage: off_session` so the saved card can
// pay renewals. The card is attached by Stripe on confirm; the client
// then calls the `default` route to make it the invoice default.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { getBillingCaller } from "@/lib/billing/api-auth";
import { getOrCreateStripeCustomer } from "@/lib/billing/customer";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const caller = await getBillingCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A free user adding a card first creates their customer (same
  // helper checkout uses; idempotent).
  let customerId = caller.customerId;
  if (!customerId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: caller.userId },
      select: { id: true, email: true, name: true },
    });
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    customerId = await getOrCreateStripeCustomer({
      prismaUserId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
    });
  }

  const intent = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { prismaUserId: caller.userId },
  });

  return NextResponse.json({ clientSecret: intent.client_secret });
}
