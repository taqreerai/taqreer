// GET /api/billing/payment-methods - the caller's saved cards for the
// /billing page (embedded billing - replaces the Stripe-hosted portal's
// payment-method list). Read-only; add/remove/default are sibling
// routes. Also returns which card is the invoice default so the UI can
// badge it.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { getBillingCaller } from "@/lib/billing/api-auth";

export async function GET() {
  const caller = await getBillingCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!caller.customerId) {
    return NextResponse.json({ paymentMethods: [], defaultId: null });
  }

  const [customer, methods] = await Promise.all([
    stripe.customers.retrieve(caller.customerId),
    stripe.customers.listPaymentMethods(caller.customerId, {
      type: "card",
      limit: 10,
    }),
  ]);

  const defaultId =
    !customer.deleted &&
    typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;

  return NextResponse.json({
    defaultId,
    paymentMethods: methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "card",
      last4: pm.card?.last4 ?? "",
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    })),
  });
}
