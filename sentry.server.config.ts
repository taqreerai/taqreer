// Sentry Node.js server-runtime init (App Router). Loaded by
// instrumentation.ts when NEXT_RUNTIME === "nodejs". DSN from SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Report from PRODUCTION only: local-dev HMR transients ("X is not defined"
  // mid-edit, stale Turbopack chunks) were flooding the project. Still tag env.
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.NODE_ENV,

  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Attach local variable values to stack frames for richer server traces.
  includeLocalVariables: true,

  enableLogs: true,
});
