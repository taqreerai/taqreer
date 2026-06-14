// Sentry Node.js server-runtime init (App Router). Loaded by
// instrumentation.ts when NEXT_RUNTIME === "nodejs". DSN from SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";

// PRODUCTION ONLY (see instrumentation-client.ts). Skip init entirely off-prod
// so local-dev HMR transients ("X is not defined" mid-edit, stale Turbopack
// chunks) can never reach the project, even via onRequestError.
if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,

    sendDefaultPii: true,
    tracesSampleRate: 0.1,

    // Attach local variable values to stack frames for richer server traces.
    includeLocalVariables: true,

    enableLogs: true,
  });
}
