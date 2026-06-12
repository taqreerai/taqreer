"use client";

// The embedded Stripe checkout (Checkout Sessions in ui_mode:
// elements) - extracted from app/[lang]/(app)/checkout/CheckoutClient
// (2026-06-12) so the SAME form serves two surfaces:
//   - the /checkout page (redirect:'always' -> /checkout/return)
//   - the UpgradeModal (redirect:'if_required' + onSuccess, so a card
//     payment completes INSIDE the modal and the user never loses
//     their in-flight create/enhance state)
// Stripe still owns the money flow: session, 3DS, webhook -> grant.

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

export function EmbeddedCheckout({
  lookupKey,
  ctx = null,
  // Modal mode: confirm with redirect:'if_required' and report success
  // to the caller instead of bouncing through /checkout/return.
  onSuccess,
}: {
  lookupKey: string;
  ctx?: "tab" | null;
  onSuccess?: () => void;
}) {
  const { locale } = useLocale();
  const router = useRouter();

  // The session's client secret, fetched once per price from our
  // auth-gated route (401 means "log in first"). Memoized so the
  // provider sees ONE stable promise.
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ lookupKey, ctx }),
    });
    if (res.status === 401) {
      router.push(localizedHref("/login", locale));
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error("checkout failed");
    const data = (await res.json()) as { clientSecret?: string };
    if (!data.clientSecret) throw new Error("no client secret");
    return data.clientSecret;
  }, [lookupKey, ctx, locale, router]);

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
  }, [lookupKey, ctx]);

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

  if (!options) return null;

  return (
    <CheckoutElementsProvider stripe={getStripe(locale)} options={options}>
      <CheckoutForm isTopup={lookupKey.startsWith("topup_")} onSuccess={onSuccess} />
    </CheckoutElementsProvider>
  );
}

function CheckoutForm({
  isTopup,
  onSuccess,
}: {
  isTopup: boolean;
  onSuccess?: () => void;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.checkout;
  const state = useCheckoutElements();
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
          href={localizedHref("/plans", locale)}
          className="btn-pill px-6 py-2.5 text-sm no-underline"
        >
          {t.back}
        </Link>
      </div>
    );
  }

  const { checkout } = state;
  // The session is created against the user's Stripe Customer, whose
  // email is FIXED for the session - Stripe rejects confirm({ email })
  // when a customer email exists (the bug that froze the pay button),
  // so the email renders read-only and confirm() takes no override.
  const amount = checkout.total.total.amount;
  const cta = (isTopup ? t.payCta : t.subscribeCta).replace("{amount}", amount);

  async function pay() {
    setPaying(true);
    setPayError(null);
    try {
      // Modal flow (onSuccess set): stay in place for card payments -
      // confirm only redirects when the method REQUIRES it (e.g. some
      // wallet/bank flows), and 3DS runs in Stripe's own overlay.
      const result = await checkout.confirm(
        onSuccess ? { redirect: "if_required" } : undefined,
      );
      if (result.type === "error") {
        setPayError(result.error.message || t.payFailed);
        setPaying(false);
        return;
      }
      // Page flow: Stripe redirects to return_url on success, so this
      // line is only ever reached in the modal flow.
      onSuccess?.();
    } catch {
      // confirm() REJECTS on integration errors (it doesn't return
      // them) - surface instead of leaving the button stuck.
      setPayError(t.payFailed);
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
          {/* The paragraph follows the page direction (so it aligns
              with the title in AR); only the amount string itself is
              BiDi-isolated - Stripe pre-formats it ("58.57 ر.س.") and
              a dir=ltr on the whole line dragged it to the far edge in
              RTL. */}
          <p className="mt-0.5 text-lg font-bold text-foreground tabular-nums">
            <bdi dir="ltr">{amount}</bdi>
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
            value={checkout.email ?? ""}
            disabled
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
