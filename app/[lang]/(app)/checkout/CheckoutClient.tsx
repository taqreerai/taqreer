"use client";

// /checkout - OUR payment page (Stripe Checkout Sessions in
// `ui_mode: elements`, user direction 2026-06-12). The whole form is
// ours: order summary, currency picker, email, Payment Element, pay
// button - themed via the Appearance API from the live design tokens
// and fully Arabic on AR pages (Payment Element supports ar; the old
// hosted/iframe Checkout did not). Stripe still owns the money flow:
// the session, 3DS, and the webhook -> ledger grant are unchanged.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckoutElementsProvider,
  useCheckoutElements,
  PaymentElement,
  CurrencySelectorElement,
} from "@stripe/react-stripe-js/checkout";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkoutAppearance, CHECKOUT_FONTS } from "@/lib/billing/appearance";

export function CheckoutClient({ lookupKey }: { lookupKey: string | null }) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.checkout;
  const router = useRouter();

  const isTopup = lookupKey?.startsWith("topup_");

  // The session's client secret, fetched once per price from our
  // auth-gated route (401 means "log in first"). Memoized so the
  // provider sees ONE stable promise.
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ lookupKey }),
    });
    if (res.status === 401) {
      router.push(localizedHref("/login", locale));
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error("checkout failed");
    const data = (await res.json()) as { clientSecret?: string };
    if (!data.clientSecret) throw new Error("no client secret");
    return data.clientSecret;
  }, [lookupKey, locale, router]);

  // Provider options are init-only and the appearance reads computed
  // CSS tokens from `document`, so build them AFTER mount (client
  // components still server-render once; `document` is undefined
  // there).
  type ProviderOptions = {
    clientSecret: Promise<string>;
    elementsOptions: { appearance: ReturnType<typeof checkoutAppearance>; fonts: typeof CHECKOUT_FONTS };
    adaptivePricing: { allowed: boolean };
  };
  const [options, setOptions] = useState<ProviderOptions | null>(null);
  useEffect(() => {
    if (!lookupKey) return;
    setOptions({
      clientSecret: fetchClientSecret(),
      elementsOptions: {
        appearance: checkoutAppearance(),
        fonts: CHECKOUT_FONTS,
      },
      // Required for the Currency Selector Element (SAR/USD localized
      // prices).
      adaptivePricing: { allowed: true },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey]);

  // Theme reactivity: the toggle flips the `light` class on <html>;
  // rebuild the appearance from the new computed tokens while KEEPING
  // the same clientSecret promise (no new session). The provider
  // diffs elementsOptions.appearance and restyles in place.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setOptions((prev) =>
        prev
          ? {
              ...prev,
              elementsOptions: {
                appearance: checkoutAppearance(),
                fonts: CHECKOUT_FONTS,
              },
            }
          : prev,
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // No / unknown price → bounce back to billing.
  useEffect(() => {
    if (!lookupKey) router.replace(localizedHref("/billing", locale));
  }, [lookupKey, locale, router]);

  if (!lookupKey || !options) return null;

  return (
    // Lives INSIDE the dashboard chrome (sidebar + top bar stay) -
    // back link + title + our form.
    <div className="page-container">
      {/* Same content frame as /billing so titles + width line up. */}
      <div className="mx-auto w-full max-w-6xl pb-16">
        <Link
          href={localizedHref("/billing", locale)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted no-underline transition-colors hover:text-foreground"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
            {dir === "rtl" ? "chevron_right" : "chevron_left"}
          </span>
          {t.back}
        </Link>

        <h1 className="text-2xl font-bold text-foreground">
          {isTopup ? t.topupTitle : t.title}
        </h1>
        <p className="mb-8 mt-2 text-sm text-muted">{t.subtitle}</p>

        <CheckoutElementsProvider stripe={getStripe(locale)} options={options}>
          <CheckoutForm isTopup={!!isTopup} />
        </CheckoutElementsProvider>
      </div>
    </div>
  );
}

function CheckoutForm({ isTopup }: { isTopup: boolean }) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.checkout;
  const state = useCheckoutElements();
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  if (state.type === "loading") {
    return (
      <div className="surface-card rounded-2xl p-8 text-center text-sm text-muted">
        {t.loading}
      </div>
    );
  }
  if (state.type === "error") {
    return (
      <div className="surface-card rounded-2xl p-8 text-center">
        <p className="mb-6 text-sm text-muted">{t.error}</p>
        <Link
          href={localizedHref("/billing", locale)}
          className="btn-pill px-6 py-2.5 text-sm no-underline"
        >
          {t.back}
        </Link>
      </div>
    );
  }

  const { checkout } = state;
  // The session carries the customer's email (we create it against the
  // Stripe Customer); a typed value overrides it at confirm time.
  const effectiveEmail = emailTouched ? email : (checkout.email ?? "");
  const amount = checkout.total.total.amount;
  const cta = (isTopup ? t.payCta : t.subscribeCta).replace("{amount}", amount);

  async function pay() {
    setPaying(true);
    setPayError(null);
    const result = await checkout.confirm({ email: effectiveEmail });
    // On success Stripe redirects to return_url; we only come back
    // here on failure.
    if (result.type === "error") {
      setPayError(result.error.message || t.payFailed);
      setPaying(false);
    }
  }

  return (
    // Two cards in one row: order details + email on the start side,
    // the payment fields + pay button on the end side (user direction
    // 2026-06-12, reverted to this split after trying the merged
    // order card).
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="surface-card flex flex-col gap-5 rounded-2xl p-6">
        {/* Order summary: line item + total (Stripe pre-formats the
            amount string in the session currency). */}
        <div className="border-b border-[var(--tq-border-hairline)] pb-4">
          <p className="text-sm font-semibold text-foreground">
            {checkout.lineItems[0]?.name}
          </p>
          <p className="mt-0.5 text-lg font-bold text-foreground tabular-nums" dir="ltr">
            {amount}
            {!isTopup && (
              <span className="text-xs font-normal text-muted"> {dict.landing.pricing.perMonth}</span>
            )}
          </p>
          {/* SAR/USD switch on its own row (it's a wide segmented
              control) - only renders when the session has currency
              options. */}
          <div className="mt-3">
            <CurrencySelectorElement />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            {t.emailLabel}
          </label>
          <input
            type="email"
            value={effectiveEmail}
            onChange={(e) => {
              setEmailTouched(true);
              setEmail(e.target.value);
            }}
            className="input-dark"
            dir="ltr"
            autoComplete="email"
          />
        </div>
      </div>

      <div className="surface-card flex flex-col gap-5 rounded-2xl p-6">
        <PaymentElement options={{ layout: "tabs" }} />

        {payError ? (
          <p className="text-sm text-[rgb(220,38,38)]" role="alert">
            {payError}
          </p>
        ) : null}

        <button
          type="button"
          onClick={pay}
          disabled={paying || !checkout.canConfirm}
          className="btn-gradient w-full py-3 text-sm disabled:opacity-60"
        >
          {paying ? t.processingPay : cta}
        </button>
      </div>
    </div>
  );
}
