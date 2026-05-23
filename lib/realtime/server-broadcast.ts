// Server-side helper for emitting Supabase Realtime broadcast messages
// from API routes + Inngest steps.
//
// Wire shape mirrors what `lib/realtime/project-channel.ts` expects on
// the client. Single export: `broadcastToProject(projectId, event,
// payload)` — caller doesn't have to think about Supabase client
// lifecycle.
//
// Why a fresh transient client per call?
//   This helper is invoked from API routes (short-lived) and Inngest
//   step bodies (also short-lived). Keeping a long-lived module-scoped
//   client around across hot reloads / serverless cold starts is more
//   trouble than it's worth — the connection cost is negligible
//   compared to the Prisma write that precedes it.
//
// Why service role?
//   Broadcast emitters bypass the channel's normal auth — the service
//   role key skips RLS and any future channel-auth restrictions.
//   Server-side fan-out is the trusted path; clients never see this key.

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import type {
  ProjectBroadcastEvent,
  ProjectBroadcastPayloadMap,
} from "./project-channel";

/**
 * Emit one broadcast message to the project channel.
 *
 * Failure-mode:
 *   Realtime is a best-effort signalling layer. If the emit fails
 *   (network blip, service-role key missing in env, etc.), we log
 *   and return — the underlying DB write that triggered this
 *   broadcast already succeeded, so clients will catch up on their
 *   next poll / refetch. Never throw — the broadcast is a courtesy,
 *   not a contract.
 */
export async function broadcastToProject<E extends ProjectBroadcastEvent>(
  projectId: string,
  event: E,
  payload: ProjectBroadcastPayloadMap[E],
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Local dev without Supabase configured (unlikely — auth would
    // also be broken) → silently no-op so we don't crash regen jobs.
    console.warn("[realtime] broadcastToProject skipped — Supabase env missing");
    return;
  }
  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      // Server-side: we open, send, close. No need to keep heartbeats.
      params: { eventsPerSecond: 10 },
    },
  });
  const topic = `project:${projectId}`;
  const channel = admin.channel(topic, {
    config: { broadcast: { self: false, ack: false } },
  });
  try {
    // The Supabase JS client requires subscribe() before send() even
    // for the service-role broadcast case. Wait for subscription to
    // succeed (or fail) before emitting.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const timer = setTimeout(finish, 3000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          finish();
        }
      });
    });
    if (channel.state === "joined") {
      await channel.send({
        type: "broadcast",
        event,
        payload,
      });
    } else {
      console.warn("[realtime] broadcast skipped — channel not joined", {
        topic,
        state: channel.state,
      });
    }
  } catch (err) {
    console.warn("[realtime] broadcastToProject failed", {
      projectId,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Tear down the transient channel + socket so we don't leak
    // websocket connections from short-lived server invocations.
    // The `finally` ensures cleanup runs even if `subscribe()` or
    // `send()` threw — otherwise we'd accumulate open channels every
    // time a broadcast hit a network blip.
    try {
      await admin.removeChannel(channel);
    } catch (removeErr) {
      console.warn("[realtime] removeChannel failed during cleanup", {
        projectId,
        error: removeErr instanceof Error ? removeErr.message : String(removeErr),
      });
    }
  }
}
