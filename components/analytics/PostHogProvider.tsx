"use client";

// PostHog capture, gated on cookie consent. We DO NOT init PostHog on load:
// the live CookieBanner offers Accept / Reject, so analytics must stay dark
// until the visitor explicitly accepts (otherwise Reject would be a lie). This
// component:
//   1. boots PostHog when consent is "accept" (server-resolved `initialConsent`
//      seeds the state so an accepted returning visitor is tracked from the
//      first paint; the banner's `taqreer:cookie-consent-accept` event flips it
//      live with no reload),
//   2. captures a `$pageview` on every App Router client navigation,
//   3. identify()s the signed-in user (PostHog treats this as required) so a
//      visitor's events link to a known person, and reset()s on logout.
// Renders nothing. Mounted once in app/[lang]/layout.tsx next to CookieBanner.
//
// Reject (or no decision) => init never runs => zero PostHog cookies/requests.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useUser } from "@/hooks/useUser";

const CONSENT_COOKIE = "tq_cookie_consent";
const ACCEPT_EVENT = "taqreer:cookie-consent-accept";

function consentAccepted(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${CONSENT_COOKIE}=accept`);
}

// Module-level so a remount (Fast Refresh, route group swap) never double-inits.
let started = false;

function startPostHog(): boolean {
  if (started) return true;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  posthog.init(key, {
    // Same-origin reverse proxy (next.config.ts rewrites /ingest/* -> PostHog
    // EU): routes capture through our own domain so ad-blockers can't drop it,
    // PostHog's recommended production setup. ui_host keeps the toolbar links
    // pointing at the real PostHog app.
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    // App Router soft navigations are captured manually below, so disable the
    // built-in pageview capture to avoid double counting.
    capture_pageview: false,
    // $pageleave (bounce rate + session duration). Explicit `true` is required
    // because capture_pageview is false (the default only ties pageleave to it).
    capture_pageleave: true,
    autocapture: true,
    // Core Web Vitals (LCP / INP / CLS) for PostHog's performance tab.
    capture_performance: { web_vitals: true },
    // Anonymous visitors stay profile-less (privacy + quota); identify() on
    // login upgrades them to a real person profile.
    person_profiles: "identified_only",
  });
  started = true;
  return true;
}

export function PostHogProvider({
  initialConsent,
}: {
  initialConsent: boolean;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  // Consent state: seeded from the server-resolved cookie (so an accepted
  // returning visitor captures from first paint) and flipped live on Accept.
  const [analyticsOn, setAnalyticsOn] = useState(initialConsent);
  // Skip the pageview on the very first render: the boot effect captures the
  // initial pageview, and the pathname effect also fires on mount.
  const firstPathname = useRef(true);

  // Banner Accept -> turn analytics on without a reload.
  useEffect(() => {
    function onAccept(): void {
      setAnalyticsOn(true);
    }
    window.addEventListener(ACCEPT_EVENT, onAccept);
    return () => window.removeEventListener(ACCEPT_EVENT, onAccept);
  }, []);

  // Boot PostHog once consent is granted; capture the entry pageview. The
  // consentAccepted() fallback covers a cookie-set-before-mount race where
  // initialConsent was resolved false.
  useEffect(() => {
    if ((analyticsOn || consentAccepted()) && startPostHog()) {
      posthog.capture("$pageview");
    }
  }, [analyticsOn]);

  // Identify the signed-in user / reset on logout, once PostHog is running.
  // distinct_id = Supabase auth uid so future server-side events (posthog-node)
  // link to the same person.
  useEffect(() => {
    if (!started) return;
    if (user) {
      posthog.identify(user.id, user.email ? { email: user.email } : undefined);
    } else {
      posthog.reset();
    }
  }, [user, analyticsOn]);

  // Pageview on each App Router client navigation, once PostHog is booted.
  useEffect(() => {
    if (firstPathname.current) {
      firstPathname.current = false;
      return;
    }
    if (started) posthog.capture("$pageview");
  }, [pathname]);

  return null;
}
