// Sentry Edge-runtime init (App Router middleware / edge routes). Loaded by
// instrumentation.ts when NEXT_RUNTIME === "edge". DSN from SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";

// PRODUCTION ONLY (see instrumentation-client.ts). Skip init entirely off-prod.
if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,

    sendDefaultPii: true,
    tracesSampleRate: 0.1,

    enableLogs: true,
  });
}
