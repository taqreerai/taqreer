// POST /api/billing/payment-methods/default - make a saved card the
// invoice default (customer-level, which renewals fall back to; the
// subscription-level default is also repointed when one exists so the
// next invoice unambiguously uses the chosen card). Ownership enforced
// like detach.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { getBillingCaller } from "@/lib/billing/api-auth";

export async function POST(request: Request) {
  const caller = await getBillingCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    paymentMethodId?: string;
  } | null;
  const pmId = body?.paymentMethodId;
  if (!pmId || !caller.customerId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (pm.customer !== caller.customerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await stripe.customers.update(caller.customerId, {
    invoice_settings: { default_payment_method: pmId },
  });
  if (caller.subscriptionId) {
    await stripe.subscriptions.update(caller.subscriptionId, {
      default_payment_method: pmId,
    });
  }

  return NextResponse.json({ ok: true });
}
