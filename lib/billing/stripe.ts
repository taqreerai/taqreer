// Server-only Stripe SDK client. Single instance, pinned API version so
// upgrades are deliberate. Throws at import if the secret is missing -
// every caller (checkout / portal / webhook / setup script) is
// server-side and needs a working client; failing loud beats a silent
// no-op on a money path.
//
// The key in use is a TEST-MODE restricted key (rk_test_...) with the
// Products/Prices/Customers/Checkout/Billing-Portal write scopes (the
// only ones the billing flows touch). Swap to a live key behind an env
// switch at launch (billing plan Phase D).

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  throw new Error("STRIPE_SECRET_KEY is required for billing.");
}

export const stripe = new Stripe(secret, {
  // Pinned to the SDK's bundled version so the typings match; bump
  // deliberately with the SDK.
  apiVersion: "2026-04-22.dahlia",
  appInfo: { name: "taqreer.ai" },
});

export const isStripeTestMode = secret.includes("_test_");
