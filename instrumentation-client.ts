// Sentry browser/client init (App Router). Per the official
// @sentry/nextjs SDK skill. DSN comes from NEXT_PUBLIC_SENTRY_DSN.
// Privacy: sendDefaultPii (visitor IP) + Session Replay (DOM) are gated on
// the `tq_cookie_consent=accept` cookie below, so they only run with opt-in.
import * as Sentry from "@sentry/nextjs";

// Mirror PostHog's consent check (components/analytics/PostHogProvider.tsx).
// Read at init; a later accept applies on the next page load.
function hasAnalyticsConsent(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === "tq_cookie_consent=accept");
}

// PRODUCTION ONLY. We skip init entirely off-prod instead of relying on
// `enabled: false` - a long-running dev server's onRequestError still leaked a
// local-HMR transient into the project. With no init there is no client, so
// nothing can send and the router-transition export below is a safe no-op.
if (process.env.NODE_ENV === "production") {
  // Error capture (no PII, no replay) runs for everyone as legitimate
  // interest; replay + IP only switch on with consent.
  const consented = hasAnalyticsConsent();
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,

    // Visitor IP, consent-gated.
    sendDefaultPii: consented,

    tracesSampleRate: 0.1,

    // Session Replay (10% of sessions, 100% on error), consent-gated.
    replaysSessionSampleRate: consented ? 0.1 : 0,
    replaysOnErrorSampleRate: consented ? 1.0 : 0,

    enableLogs: true,

    // Replay integration only when consented; masked even then (never record
    // text content or media).
    integrations: consented
      ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]
      : [],
  });
}

// App Router navigation instrumentation. No-op without an initialised client.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
