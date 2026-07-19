"use client";

// Fires the Google Ads "Sign-up" conversion once per new account. Mounted on
// the dashboard - the page every signup path lands on (email-instant,
// email-confirm, Google OAuth). The server route decides IF we fire (fresh
// signup only) and hands back the send_to + a transaction_id; this just relays
// that to the gtag queue. Renders nothing.
//
// The DONE_COOKIE short-circuit means each browser hits the route at most once,
// so this is effectively free for returning users.

import { useEffect } from "react";
import { trackAdsConversion } from "./GoogleAdsTag";

const DONE_COOKIE = "tq_sconv";

export function SignupConversion() {
  useEffect(() => {
    // Already resolved for this browser - skip the round trip entirely.
    if (
      document.cookie
        .split("; ")
        .some((c) => c.startsWith(`${DONE_COOKIE}=`))
    ) {
      return;
    }

    let cancelled = false;
    fetch("/api/ads/signup-conversion", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.fire || !data.sendTo) return;
        trackAdsConversion(data.sendTo, data.transactionId);
      })
      .catch(() => {
        // Non-critical: a missed conversion beats a broken dashboard.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
