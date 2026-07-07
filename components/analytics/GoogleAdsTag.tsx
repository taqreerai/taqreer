"use client";

// Google Ads tag (gtag.js, AW conversion measurement), integrated with the
// cookie-consent banner via GOOGLE CONSENT MODE v2 - a deliberately different
// posture from PostHog's hard gate:
//
//   - The tag loads for EVERYONE (async, after hydration). The dataLayer is
//     seeded with a consent DEFAULT of "denied" BEFORE the config command, so
//     with no consent the tag sets no cookies and sends only cookieless pings
//     (Google uses those for conversion modeling). This also keeps Google
//     Ads' "Test installation" / tag diagnostics green - a hard-gated tag
//     looks "missing" to Google and breaks the URL-based conversion goals.
//   - When the visitor accepts the banner (tq_cookie_consent=accept, live via
//     the taqreer:cookie-consent-accept event - same contract as
//     PostHogProvider), we push a consent UPDATE to "granted".
//
// ORDERING GUARANTEE (CodeRabbit, PR #113): default and update are pushed
// from the SAME code path (ensureConfigured() runs first inside the mount
// effect, before any grantConsent()), not from a separate <Script> that could
// race the effect. gtag.js drains the dataLayer queue in insertion order
// whenever it finishes loading, so default always precedes update.
//
// Conversions measured today: the Ads-side "Sign ups" page-load goal
// (/dashboard). A precise code-fired signup conversion can be added later via
// gtag('event','conversion',{send_to:'AW-.../<label>'}) once a conversion
// action with a label exists in the Ads account.
//
// Renders the loader script only; mounted once in app/[lang]/layout.tsx next
// to PostHogProvider. No-ops entirely when NEXT_PUBLIC_GOOGLE_ADS_ID is unset
// (local dev / preview environments stay tag-free).

import { useEffect } from "react";
import Script from "next/script";

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

const CONSENT_COOKIE = "tq_cookie_consent";
const ACCEPT_EVENT = "taqreer:cookie-consent-accept";

function consentAccepted(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${CONSENT_COOKIE}=accept`);
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function gtag(..._args: unknown[]): void {
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads `arguments` objects pushed onto dataLayer (a plain array
  // does not register) - this mirrors Google's stock snippet.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

// Module-level so a remount (Fast Refresh, route group swap) never re-seeds
// the queue with a second default/config pair.
let configured = false;

// Seed the queue: consent default (denied) MUST be the first consent command
// gtag.js sees, then js + config. Called before any grantConsent().
function ensureConfigured(): void {
  if (configured) return;
  configured = true;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  gtag("js", new Date());
  gtag("config", ADS_ID);
}

function grantConsent(): void {
  ensureConfigured(); // belt-and-suspenders: default always precedes update
  gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
}

export function GoogleAdsTag() {
  // Seed defaults, then upgrade consent: on mount for returning accepted
  // visitors, live on the banner's Accept event for first-time visitors.
  useEffect(() => {
    if (!ADS_ID) return;
    ensureConfigured();
    if (consentAccepted()) grantConsent();
    const onAccept = () => grantConsent();
    window.addEventListener(ACCEPT_EVENT, onAccept);
    return () => window.removeEventListener(ACCEPT_EVENT, onAccept);
  }, []);

  if (!ADS_ID) return null;

  // The library drains whatever the effect queued, in order, once loaded.
  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`}
      strategy="afterInteractive"
    />
  );
}
