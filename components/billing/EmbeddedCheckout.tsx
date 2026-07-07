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
import { pollPurchaseSettled } from "@/lib/billing/poll-purchase";

export function EmbeddedCheckout({
  lookupKey,
  // Modal mode: confirm with redirect:'if_required' and report success
  // to the caller instead of bouncing through /checkout/return.
  onSuccess,
}: {
  lookupKey: string;
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
    // SSR-safe init the rule can't model: the Stripe appearance reads computed
    // CSS tokens from `document` (undefined on the server), so options must be
    // built after mount; and the clientSecret promise must be created exactly
    // once per lookupKey (rebuilding it opens a new checkout session), so this
    // can't move to a lazy initializer or useMemo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  if (!options) return null;

  return (
    <CheckoutElementsProvider stripe={getStripe(locale)} options={options}>
      <CheckoutForm
        isTopup={lookupKey.startsWith("topup_")}
        // Promo codes are enabled on YEARLY subscription sessions only
        // (mirror of the server's allow_promotion_codes condition in
        // /api/stripe/checkout - applying a code on any other session
        // would be rejected by Stripe anyway).
        allowPromo={lookupKey.endsWith("_yearly")}
        onSuccess={onSuccess}
      />
    </CheckoutElementsProvider>
  );
}

function CheckoutForm({
  isTopup,
  allowPromo,
  onSuccess,
}: {
  isTopup: boolean;
  allowPromo: boolean;
  onSuccess?: () => void;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.checkout;
  const state = useCheckoutElements();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Promo code entry (yearly sessions only). The applied state is read
  // from the session's own discountAmounts, so it survives re-renders
  // and currency switches without local mirroring.
  const [promoDraft, setPromoDraft] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

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
  // The session's applied discount (only ever one promo at a time in
  // our flow). Stripe recomputes total.total after apply/remove, so the
  // order summary + CTA amounts above track it automatically.
  const appliedDiscount = checkout.discountAmounts?.[0] ?? null;

  async function applyPromo() {
    const code = promoDraft.trim();
    if (!code) return;
    setPromoBusy(true);
    setPromoError(null);
    try {
      const result = await checkout.applyPromotionCode(code);
      if (result.type === "error") {
        setPromoError(result.error.message || t.promoInvalid);
      } else {
        setPromoDraft("");
      }
    } catch {
      setPromoError(t.promoInvalid);
    } finally {
      setPromoBusy(false);
    }
  }

  async function removePromo() {
    setPromoBusy(true);
    setPromoError(null);
    try {
      // Same discriminated result shape as applyPromotionCode - an error
      // resolves (not rejects), so surface it or removal looks successful.
      const result = await checkout.removePromotionCode();
      if (result.type === "error") {
        setPromoError(result.error.message || t.promoInvalid);
      }
    } catch {
      setPromoError(t.promoInvalid);
    } finally {
      setPromoBusy(false);
    }
  }

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
      // line is only ever reached in the modal flow. The subscription grant
      // lands via an async webhook a beat after this confirm resolves, so poll
      // the credit + notification stores until it does — credits, the new
      // plan, and the bell badge fill in place with no manual refresh.
      void pollPurchaseSettled();
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

        {/* Promo code - yearly subscriptions only (mirrors the server's
            allow_promotion_codes). Applied state renders as a removable
            row; the amounts above re-derive from the session. */}
        {allowPromo ? (
          <div>
            <label
              htmlFor="promo-code"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              {t.promoLabel}
            </label>
            {appliedDiscount ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--tq-border-hairline)] px-3 py-2">
                <span className="text-sm text-foreground">
                  {t.promoApplied.replace(
                    "{code}",
                    appliedDiscount.promotionCode ?? appliedDiscount.displayName,
                  )}
                  <span className="ms-2 text-xs text-muted tabular-nums">
                    <bdi dir="ltr">-{appliedDiscount.amount}</bdi>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={removePromo}
                  disabled={promoBusy || paying}
                  className="text-xs text-muted underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {t.promoRemove}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  id="promo-code"
                  type="text"
                  value={promoDraft}
                  onChange={(e) => setPromoDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyPromo();
                    }
                  }}
                  placeholder={t.promoPlaceholder}
                  // h-12 pins the row height so the input and the Apply
                  // button match each other (and the email field below).
                  className="input-dark h-12 min-w-0 flex-1 py-0"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={promoBusy || paying || promoDraft.trim() === ""}
                  // Fixed 30% of the row: a width (not padding) so the short
                  // label ("تطبيق" / "Apply") can never collapse the pill
                  // into a circle (.btn-pill's own padding beats px-*
                  // utilities - unlayered CSS wins over Tailwind layers).
                  className="btn-pill h-12 w-[30%] shrink-0 text-sm disabled:opacity-50"
                >
                  {promoBusy ? t.promoApplying : t.promoApply}
                </button>
              </div>
            )}
            {promoError ? (
              <p className="mt-2 text-xs text-danger" role="alert">
                {promoError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            {t.emailLabel}
          </label>
          <input
            type="email"
            value={checkout.email ?? ""}
            disabled
            className="input-dark h-12 py-0"
            dir="ltr"
            autoComplete="email"
          />
        </div>
      </div>

      <div className="surface-card flex flex-col gap-5 rounded-2xl p-6">
        {/* Accordion (not tabs): the wallet set (Apple/Google/Cash App/Bank/
            Card) crams + shrinks in a tab row; accordion stacks each method
            full-width with breathing room and keeps the recommended one
            expanded. */}
        <PaymentElement options={{ layout: "accordion" }} />

        {payError ? (
          <p className="text-sm text-danger" role="alert">
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
