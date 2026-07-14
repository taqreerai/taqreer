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

const CONSENT_COOKIE = "tq_cookie_consent";
const ACCEPT_EVENT = "taqreer:cookie-consent-accept";

function consentAccepted(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${CONSENT_COOKIE}=accept`);
}

// One-time sweep of legacy PostHog cookies. Before we moved to
// `persistence: "localStorage"` (see startPostHog), posthog-js wrote a
// `ph_<key>_posthog` cookie that rode EVERY request to the origin, including
// the login POST, stacking on the Supabase auth chunks + Cloudflare cookies to
// push the Cookie header past nginx's request-header buffer -> 400 "Request
// Header Or Cookie Too Large". Switching persistence stops NEW writes, but
// posthog-js does not delete the already-set cookie, so returning visitors keep
// carrying ~950 bytes of dead weight (observed: two keys, the current one plus
// one stale from a past key rotation). Expire any `ph_*_posthog` cookie across
// the path/domain variants PostHog may have used. Cheap no-op once clean; safe
// because all PostHog state now lives in localStorage.
function clearLegacyPostHogCookies(): void {
  if (typeof document === "undefined") return;
  const names = document.cookie
    .split("; ")
    .map((c) => c.split("=")[0])
    .filter((n) => /^ph_.*_posthog$/.test(n));
  if (names.length === 0) return;
  const host = location.hostname;
  const apex = "." + host.split(".").slice(-2).join(".");
  const past = "Thu, 01 Jan 1970 00:00:00 GMT";
  for (const n of names) {
    document.cookie = `${n}=; expires=${past}; path=/`;
    document.cookie = `${n}=; expires=${past}; path=/; domain=${host}`;
    document.cookie = `${n}=; expires=${past}; path=/; domain=${apex}`;
  }
}

// Module-level so a remount (Fast Refresh, route group swap) never double-inits.
let started = false;

// Read by <PostHogIdentify> (app-only) so it identifies the user only once
// PostHog is actually booted (consent granted). Kept here because `started` is
// module-private. PostHogIdentify lives in its own file so the Supabase client
// (useUser) is NOT pulled into the static marketing bundle — only the app.
export function posthogStarted(): boolean {
  return started;
}

function startPostHog(): boolean {
  if (started) return true;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  posthog.init(key, {
    // PostHog MANAGED reverse proxy (d.taqreer.ai, provisioned in PostHog and
    // CNAME'd to their infra): capture routes through our own subdomain and
    // PostHog handles the proxy natively. Ad-blocker-proof, and avoids the edge
    // 503 a hand-rolled Next.js rewrite proxy hit. ui_host points toolbar/links
    // at the PostHog app. (The server-side Query API still hits eu.i.posthog.com
    // directly via NEXT_PUBLIC_POSTHOG_HOST - see lib/analytics/posthog.ts.)
    api_host: "https://d.taqreer.ai",
    ui_host: "https://eu.posthog.com",
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
    // Persist in localStorage ONLY, never a cookie. posthog-js defaults to
    // `localStorage+cookie` with `cross_subdomain_cookie: true`, which writes a
    // `ph_*` cookie scoped to `.taqreer.ai` that then rides EVERY request to the
    // origin, including the login POST. Stacked on the Supabase auth-token
    // chunks + Cloudflare cookies that pushed the Cookie header past nginx's
    // request-header buffer -> intermittent 400 "Request Header Or Cookie Too
    // Large" on login. distinct_id in localStorage is shared across tabs on the
    // origin; d.taqreer.ai is ingest-only (no pages) so cross-subdomain cookie
    // identity buys us nothing. Keeps the auth request path cookie-lean.
    persistence: "localStorage",
  });
  started = true;
  return true;
}

export function PostHogProvider({
  // Optional: on statically-rendered pages the layout can't read the consent
  // cookie server-side, so this defaults to false. The boot effect's
  // consentAccepted() fallback (below) reads the cookie on mount, so a returning
  // accepted visitor is still tracked.
  initialConsent = false,
}: {
  initialConsent?: boolean;
}) {
  const pathname = usePathname();
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

  // Retire any pre-existing `ph_*_posthog` cookie once, for every visitor,
  // regardless of consent. We are localStorage-only now, so these are dead
  // weight on the request path (see clearLegacyPostHogCookies).
  useEffect(() => {
    clearLegacyPostHogCookies();
  }, []);

  // Boot PostHog once consent is granted; capture the entry pageview. The
  // consentAccepted() fallback covers a cookie-set-before-mount race where
  // initialConsent was resolved false.
  useEffect(() => {
    if ((analyticsOn || consentAccepted()) && startPostHog()) {
      posthog.capture("$pageview");
    }
  }, [analyticsOn]);

  // User identify/reset lives in <PostHogIdentify> (mounted only in the (app)
  // layout) so the Supabase client it needs stays out of the marketing bundle.

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
