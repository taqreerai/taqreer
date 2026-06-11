// Per-user Supabase Realtime channel — sibling to `project-channel.ts`.
//
// Why two channels (project + user)?
//   The project channel carries events tied to ONE project (comments,
//   regen progress, lock toggles). Anyone with access to that project
//   subscribes — broadcast is server → many.
//   The user channel carries events tied to ONE recipient — primarily
//   bell notifications (`notification.created`). Only that recipient
//   subscribes — broadcast is server → one. Splitting topics keeps
//   the receive set tight (the user channel never delivers events the
//   recipient shouldn't see) and lets the bell live independent of
//   any project context.
//
// Topic shape: `user:{prismaUserId}`. Prisma id (not Supabase auth id)
// to match the rest of the realtime payload conventions — the bell
// fan-out helper writes Notification.recipientUserId as a Prisma id
// and broadcasts to that same topic without translation.
//
// Subscribe ordering:
//   Same pattern as project-channel.ts — pre-register one Supabase
//   listener per known event type before `channel.subscribe()`, then
//   fan out to JS-level subscribers added by `on(...)`. Lets consumers
//   safely add listeners AFTER the channel has joined.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeBrowserClient } from "./supabase-browser";

// Broadcast event names — typed union so emitters + consumers agree
// on the wire format. Add new entries here BEFORE emitting them; the
// pre-registered Supabase listener for each entry needs to exist
// before the channel subscribes (the on/subscribe ordering rule).
export type UserBroadcastEvent =
  | "notification.created"
  | "share.revoked"
  | "credit.balance.changed";

const USER_BROADCAST_EVENTS: readonly UserBroadcastEvent[] = [
  "notification.created",
  "share.revoked",
  "credit.balance.changed",
];

// Wire payload shapes per event. `server-broadcast.ts` enforces the
// matching shape at emit time via the same map.
export type UserBroadcastPayloadMap = {
  // Pointer-only. The bell fetches the full Notification row via REST
  // (GET /api/notifications/[id]) so we don't pay per-event for a
  // bunch of joined columns (actor name + avatar, project title,
  // etc.) over the socket. Same dereference pattern as the project
  // channel's comment.created.
  "notification.created": {
    notificationId: string;
  };
  // Fired when the owner revokes an accepted share. Tells the
  // recipient's open browser to drop access — clients listening on
  // this event hard-redirect to `/dashboard` if they're currently
  // viewing the revoked `projectId`. Includes `projectTitle` only
  // for a toast (UI nicety; not required for the redirect).
  "share.revoked": {
    projectId: string;
    projectTitle?: string;
  };
  // POINTER-ONLY, like notification.created - deliberately an empty
  // signal. The `user:{id}` topics are public broadcast channels (no
  // private-channel authorization yet), so the socket must never carry
  // the balance itself: anyone with the anon key and a harvested
  // Prisma id could subscribe to another user's topic and read it
  // (security review 2026-06-11). Consumers refetch the auth-gated
  // GET /api/credits instead - that route is the ONLY data path.
  // Emitted by lib/credits/server.ts after every ledger mutation
  // (hold / settle / grant / reset / expiry).
  "credit.balance.changed": Record<string, never>;
};

export type UserChannelHandle = {
  channel: RealtimeChannel;
  on: <E extends UserBroadcastEvent>(
    event: E,
    handler: (payload: UserBroadcastPayloadMap[E]) => void,
  ) => void;
  close: () => Promise<void>;
};

/**
 * Open a per-user channel and start its subscription. Caller owns
 * the close — typically wired through `notificationStore.setUser` so
 * the channel lifecycle tracks the auth lifecycle (open on login,
 * close on logout, re-open on user change).
 */
export function openUserChannel(prismaUserId: string): UserChannelHandle {
  if (!prismaUserId || typeof prismaUserId !== "string") {
    throw new Error("[realtime] openUserChannel: prismaUserId is required");
  }
  const client = getRealtimeBrowserClient();
  const topic = `user:${prismaUserId}`;

  const channel = client.channel(topic, {
    config: {
      // Don't echo our own broadcasts. This is mostly belt-and-
      // suspenders — only the SERVER writes to this topic, but the
      // self-flag costs nothing.
      broadcast: { self: false, ack: false },
    },
  });

  type BroadcastSubscribers = {
    [E in UserBroadcastEvent]: Array<
      (payload: UserBroadcastPayloadMap[E]) => void
    >;
  };
  const subscribers: BroadcastSubscribers = {
    "notification.created": [],
    "share.revoked": [],
    "credit.balance.changed": [],
  };

  // Pre-register one Supabase listener per event name. See project-
  // channel.ts for the rationale on the lazy-subscribe pattern.
  for (const event of USER_BROADCAST_EVENTS) {
    channel.on(
      "broadcast" as unknown as never,
      { event } as never,
      ((msg: { event: string; payload: unknown; type: string }) => {
        const subs = subscribers[event];
        for (const sub of subs) {
          sub(msg.payload as never);
        }
      }) as never,
    );
  }

  channel.subscribe();

  return {
    channel,
    on(event, handler) {
      (subscribers[event] as Array<typeof handler>).push(handler);
    },
    async close() {
      await client.removeChannel(channel);
    },
  };
}
