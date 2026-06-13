// Sentry Edge-runtime init (App Router middleware / edge routes). Loaded by
// instrumentation.ts when NEXT_RUNTIME === "edge". DSN from SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  enableLogs: true,
});
