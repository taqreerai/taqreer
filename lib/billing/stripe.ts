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

// A LIVE Stripe client for read-only money reporting (the admin balance card),
// so it never shows a test-mode figure. Resolution, in order:
//   1. STRIPE_LIVE_SECRET_KEY (a dedicated live key - ideally a RESTRICTED
//      read-only key) when set. This is how local dev sees the real balance
//      without swapping its default test key.
//   2. the default key when it is ALREADY live (prod).
//   3. null - no live key in this environment, so callers show "n/a" rather
//      than a misleading test balance.
// Cached: `undefined` = not resolved yet, `null` = resolved to "no live key".
let liveClient: Stripe | null | undefined;
export function getLiveStripeOrNull(): Stripe | null {
  if (liveClient !== undefined) return liveClient;
  const explicit = process.env.STRIPE_LIVE_SECRET_KEY;
  const liveKey = explicit?.includes("_live_")
    ? explicit
    : isStripeTestMode
      ? null
      : secret;
  liveClient = liveKey
    ? new Stripe(liveKey, {
        apiVersion: "2026-04-22.dahlia",
        appInfo: { name: "taqreer.ai" },
      })
    : null;
  return liveClient;
}
