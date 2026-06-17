import "server-only";

import { PostHog } from "posthog-node";

// Server-side PostHog capture (posthog-node) for the conversion funnel + any
// other backend events. Separate from lib/analytics/posthog.ts, which is the
// READ layer (Query API). Sends to PostHog EU directly (server -> ingestion,
// 200 from any server; the d.taqreer.ai managed proxy is only for the browser).
//
// distinctId MUST be the Supabase auth uid, so server events line up with the
// client's posthog.identify(user.id) (PostHogProvider.tsx) - same person.
//
// Fire-and-forget + never throws: analytics must never break a request.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!KEY) return null;
  if (!client) {
    // flushAt: 1 -> send each event promptly. We run a long-lived pm2 process
    // at low volume, so per-event sends are fine and avoid losing queued events
    // on a deploy reload.
    client = new PostHog(KEY, { host: HOST, flushAt: 1, flushInterval: 0 });
  }
  return client;
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  try {
    if (!distinctId) return;
    getClient()?.capture({ distinctId, event, properties });
  } catch {
    /* best-effort: swallow so analytics never breaks the caller */
  }
}
