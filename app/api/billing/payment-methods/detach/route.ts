// POST /api/billing/payment-methods/detach - remove a saved card.
// Ownership is enforced by retrieving the payment method and comparing
// its customer to the CALLER's customer (the id alone is client input).
// Removing the card a live subscription bills with is refused - the
// user must add/set another default first (prevents self-inflicted
// dunning).

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

  if (caller.subscriptionId) {
    const [customer, sub] = await Promise.all([
      stripe.customers.retrieve(caller.customerId),
      stripe.subscriptions.retrieve(caller.subscriptionId),
    ]);
    const customerDefault =
      !customer.deleted &&
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : null;
    const subDefault =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : null;
    // The card that would actually bill the next renewal (sub default
    // wins, else the customer default).
    const billingCard = subDefault ?? customerDefault;
    const isCanceling = sub.cancel_at_period_end || sub.status === "canceled";
    if (!isCanceling && billingCard === pmId) {
      return NextResponse.json({ error: "default_in_use" }, { status: 409 });
    }
  }

  await stripe.paymentMethods.detach(pmId);
  return NextResponse.json({ ok: true });
}
