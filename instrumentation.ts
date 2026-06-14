// Server-side Sentry registration. THIS FILE WAS MISSING - without it the
// server/edge configs below never load, so server-side errors went
// uncaptured. register() loads the right config per runtime; onRequestError
// auto-captures unhandled errors from server components / route handlers.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // PRODUCTION ONLY: don't even load the server/edge configs off-prod, so no
  // client exists locally and onRequestError below stays a no-op.
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
