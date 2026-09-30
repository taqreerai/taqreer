// GET /api/billing/invoices - the caller's invoice history for the
// /invoices page (embedded billing). We render the table ourselves;
// each row links Stripe's hosted invoice page, which shows the paid state
// plus both the invoice and the receipt downloads (the raw invoice PDF of a
// post-payment top-up invoice reads "due" even when paid). A view, not a
// flow - the user never manages anything on Stripe.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { getBillingCaller } from "@/lib/billing/api-auth";

export async function GET() {
  const caller = await getBillingCaller();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!caller.customerId) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await stripe.invoices.list({
    customer: caller.customerId,
    limit: 24,
  });

  return NextResponse.json({
    invoices: invoices.data
      // Draft invoices are internal Stripe state, not user history.
      .filter((inv) => inv.status !== "draft")
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        created: new Date(inv.created * 1000).toISOString(),
        description:
          inv.lines.data[0]?.description ?? inv.description ?? null,
        // Minor units + currency; the client formats.
        total: inv.total,
        currency: inv.currency,
        status: inv.status, // open | paid | uncollectible | void
        url: inv.hosted_invoice_url ?? inv.invoice_pdf ?? null,
      })),
  });
}
