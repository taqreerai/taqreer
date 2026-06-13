// Server-side Sentry registration. THIS FILE WAS MISSING - without it the
// server/edge configs below never load, so server-side errors went
// uncaptured. register() loads the right config per runtime; onRequestError
// auto-captures unhandled errors from server components / route handlers.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
