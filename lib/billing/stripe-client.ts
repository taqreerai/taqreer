"use client";

// Browser-side Stripe.js loader (singleton). Used only by the embedded
// checkout page to mount Stripe's payment form INSIDE our own page -
// the user stays on taqreer.ai, our chrome around it, the card form
// themed to our brand via the Stripe Dashboard branding settings.
//
// The publishable key is PUBLIC by design (it can only create
// client-side tokens, never move money - that's the secret key's job
// on the server). Exposed as NEXT_PUBLIC_ so it reaches the bundle.

import { loadStripe, type Stripe } from "@stripe/stripe-js";

let promise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!promise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing");
      return Promise.resolve(null);
    }
    promise = loadStripe(key);
  }
  return promise;
}
