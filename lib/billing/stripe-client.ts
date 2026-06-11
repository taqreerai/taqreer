"use client";

// Browser-side Stripe.js loader. Used by the /checkout page to mount
// Stripe's payment components INSIDE our own page - the user stays on
// taqreer.ai with our chrome around the form.
//
// Cached per LOCALE: Stripe.js takes the UI language at load time, and
// Payment Element supports Arabic (unlike the old hosted/iframe
// Checkout), so the AR pages get a fully Arabic payment form.
//
// The publishable key is PUBLIC by design (it can only create
// client-side tokens, never move money - that's the secret key's job
// on the server). Exposed as NEXT_PUBLIC_ so it reaches the bundle.

import { loadStripe, type Stripe } from "@stripe/stripe-js";

const promises: Partial<Record<"ar" | "en", Promise<Stripe | null>>> = {};

export function getStripe(locale: "ar" | "en" = "en"): Promise<Stripe | null> {
  let promise = promises[locale];
  if (!promise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing");
      return Promise.resolve(null);
    }
    promise = loadStripe(key, { locale });
    promises[locale] = promise;
  }
  return promise;
}
