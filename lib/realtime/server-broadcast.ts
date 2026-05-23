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
// Hard wall-clock cap on the entire broadcast attempt. If Supabase
// is unreachable or `admin.removeChannel(channel)` deadlocks waiting
// on a graceful close that never comes (observed 2026-05-23 — an
// Inngest run reported a "start" job and then nothing for 5+ min;
// trace narrowed it to the broadcast step blocking the function
// before the Anthropic call ever ran), this race aborts and returns.
// Best-effort signalling layer; never block a regen / comment write.
const BROADCAST_OVERALL_TIMEOUT_MS = 3000;

// Helper — race a promise against a timer that resolves silently.
// Doesn't reject on timeout so the caller can keep its single
// `try/catch` shape clean. If the work finishes first, the timer
// is GC'd; if the timer fires first, the work continues in the
// background (Node will let it run; on serverless it may be killed
// when the handler returns — both acceptable for a courtesy signal).
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  tag: string,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutP = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[realtime] ${tag} timeout after ${ms}ms`);
      resolve("timeout");
    }, ms);
  });
  return Promise.race([
    work.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutP,
  ]);
}

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
  // Wrap the entire broadcast attempt in a single overall timeout so
  // a hanging Supabase socket can never block the caller. The work
  // itself still releases the channel in its own try/finally.
  await withTimeout(
    (async () => {
      const admin = createSupabaseAdminClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      });
      const topic = `project:${projectId}`;
      const channel = admin.channel(topic, {
        config: { broadcast: { self: false, ack: false } },
      });
      try {
        // The Supabase JS client requires subscribe() before send().
        // 2-second internal cap (the outer 3 s race covers the rest).
        await new Promise<void>((resolve) => {
          let resolved = false;
          const finish = () => {
            if (resolved) return;
            resolved = true;
            resolve();
          };
          const timer = setTimeout(finish, 2000);
          channel.subscribe((status) => {
            if (
              status === "SUBSCRIBED" ||
              status === "CHANNEL_ERROR" ||
              status === "TIMED_OUT"
            ) {
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
        // Tear down the transient channel + socket. `removeChannel`
        // can deadlock when the channel never finished subscribing
        // (waits for a graceful close that never arrives) — the
        // outer `withTimeout` is the hard backstop.
        try {
          await admin.removeChannel(channel);
        } catch (removeErr) {
          console.warn("[realtime] removeChannel failed during cleanup", {
            projectId,
            error:
              removeErr instanceof Error ? removeErr.message : String(removeErr),
          });
        }
      }
    })(),
    BROADCAST_OVERALL_TIMEOUT_MS,
    `broadcastToProject(${event})`,
  );
}
