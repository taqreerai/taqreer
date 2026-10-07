"use client";

// /checkout - OUR payment page (Stripe Checkout Sessions in
// `ui_mode: elements`, user direction 2026-06-12). Page chrome only -
// the form itself lives in components/billing/EmbeddedCheckout, shared
// with the UpgradeModal (gated-preset upgrade flow).

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { EmbeddedCheckout } from "@/components/billing/EmbeddedCheckout";
import { CheckoutBoundary } from "@/components/billing/CheckoutBoundary";

export function CheckoutClient({
  lookupKey,
}: {
  lookupKey: string | null;
}) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.checkout;
  const router = useRouter();

  const isTopup = lookupKey?.startsWith("topup_");

  // No / unknown price → bounce back to billing.
  useEffect(() => {
    if (!lookupKey) router.replace(localizedHref("/plans", locale));
  }, [lookupKey, locale, router]);

  if (!lookupKey) return null;

  return (
    // Lives INSIDE the dashboard chrome (sidebar + top bar stay) -
    // back link + title + our form.
    <div className="page-container">
      {/* Same content frame as /billing so titles + width line up. */}
      <div className="mx-auto w-full max-w-6xl pb-16">
        <Link
          href={localizedHref("/plans", locale)}
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

        <CheckoutBoundary where="checkout-page">
          <EmbeddedCheckout lookupKey={lookupKey} />
        </CheckoutBoundary>
      </div>
    </div>
  );
}
