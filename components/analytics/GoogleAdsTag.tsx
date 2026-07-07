"use client";

// Google Ads tag (gtag.js, AW conversion measurement), integrated with the
// cookie-consent banner via GOOGLE CONSENT MODE v2 - a deliberately different
// posture from PostHog's hard gate:
//
//   - The tag itself loads for EVERYONE (async, after hydration). Before it
//     does, a consent DEFAULT of "denied" is pushed, so with no consent the
//     tag sets no cookies and sends only cookieless pings (Google uses those
//     for conversion modeling). This also keeps Google Ads' "Test
//     installation" / tag diagnostics green - a hard-gated tag looks
//     "missing" to Google and breaks the URL-based conversion goals.
//   - When the visitor accepts the banner (tq_cookie_consent=accept, live via
//     the taqreer:cookie-consent-accept event - same contract as
//     PostHogProvider), we push a consent UPDATE to "granted".
//
// Conversions measured today: the Ads-side "Sign ups" page-load goal
// (/dashboard). A precise code-fired signup conversion can be added later via
// gtag('event','conversion',{send_to:'AW-.../<label>'}) once a conversion
// action with a label exists in the Ads account.
//
// Renders the script tags only; mounted once in app/[lang]/layout.tsx next to
// PostHogProvider. No-ops entirely when NEXT_PUBLIC_GOOGLE_ADS_ID is unset
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

function grantConsent(): void {
  gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
}

export function GoogleAdsTag() {
  // Upgrade consent: on mount for returning accepted visitors, live on the
  // banner's Accept event for first-time visitors.
  useEffect(() => {
    if (!ADS_ID) return;
    if (consentAccepted()) grantConsent();
    const onAccept = () => grantConsent();
    window.addEventListener(ACCEPT_EVENT, onAccept);
    return () => window.removeEventListener(ACCEPT_EVENT, onAccept);
  }, []);

  if (!ADS_ID) return null;

  return (
    <>
      {/* Consent defaults MUST run before the library processes config -
          beforeInteractive is overkill; both scripts are afterInteractive and
          dataLayer ordering guarantees the default precedes config. */}
      <Script id="google-ads-consent-default" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied'
          });
          gtag('js', new Date());
          gtag('config', '${ADS_ID}');
        `}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`}
        strategy="afterInteractive"
      />
    </>
  );
}
