// /[lang]/checkout?price=<lookupKey>
//
// Embedded Stripe Checkout, rendered INSIDE our own page (user
// direction 2026-06-11: keep people on taqreer.ai with our branding).
// A focused branded shell - logo + back link + the Stripe form mounted
// via EmbeddedCheckout. The form is themed in the Stripe Dashboard
// branding settings; everything around it is ours.
//
// Auth is enforced by the checkout API (401 → we send the user to
// login). The actual grant lands via the webhook; the return page
// (/checkout/return) handles the post-payment UX.

import { CheckoutClient } from "./CheckoutClient";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ price?: string }>;
}) {
  const { price } = await searchParams;
  return <CheckoutClient lookupKey={price ?? null} />;
}
