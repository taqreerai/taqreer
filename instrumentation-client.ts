// Sentry browser/client init (App Router). Per the official
// @sentry/nextjs SDK skill. DSN comes from NEXT_PUBLIC_SENTRY_DSN.
// NOTE (privacy, revisit in Phase B legal): sendDefaultPii + Session
// Replay capture user IP / DOM - dial these back once the privacy policy
// lands if we want a leaner footprint.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  sendDefaultPii: true,

  // 100% traces in dev, 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with an error.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  // Replay with the project's existing privacy masking (carried over from the
  // old sentry.client.config.ts): never record text content or media.
  integrations: [
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
});

// App Router navigation instrumentation.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
