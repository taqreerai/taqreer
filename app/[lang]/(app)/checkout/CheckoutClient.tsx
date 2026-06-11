"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { getStripe } from "@/lib/billing/stripe-client";

export function CheckoutClient({ lookupKey }: { lookupKey: string | null }) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.checkout;
  const router = useRouter();
  const [error, setError] = useState(false);

  const isTopup = lookupKey?.startsWith("topup_");

  // Fetch the embedded session's client secret from our checkout route.
  // The route is auth-gated; a 401 means "log in first".
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

  // No / unknown price → bounce back to billing.
  useEffect(() => {
    if (!lookupKey) router.replace(localizedHref("/billing", locale));
  }, [lookupKey, locale, router]);

  if (!lookupKey) return null;

  return (
    // Lives INSIDE the dashboard chrome now (sidebar + top bar stay,
    // user direction 2026-06-11) - back link + title + the embedded form.
    <div className="page-container">
      <div className="mx-auto w-full max-w-2xl pb-16">
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

        {error ? (
          <div className="surface-card rounded-2xl p-8 text-center">
            <p className="mb-6 text-sm text-muted">{t.error}</p>
            <Link
              href={localizedHref("/billing", locale)}
              className="btn-pill px-6 py-2.5 text-sm no-underline"
            >
              {t.back}
            </Link>
          </div>
        ) : (
          // Stripe's embedded form. It carries its own loading state; the
          // surrounding card keeps it visually inside our chrome.
          <div className="overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)] bg-white p-1">
            <EmbeddedCheckoutProvider
              stripe={getStripe()}
              options={{ fetchClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </div>
    </div>
  );
}
