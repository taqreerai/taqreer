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
// Topic shape: `user:{supabaseUserId}` (the auth uid, NOT the prisma
// id). The private-channel policy on realtime.messages authorizes a
// join by matching the topic against the minted token's `topics`
// claim, and the token route derives that claim from the Supabase
// session - so the topic must carry the identity Supabase knows.
// Server-side, `broadcastToUser` still ACCEPTS a prisma id (what every
// fan-out path holds) and resolves it to the supabase id at send time.
//
// Subscribe ordering:
//   Same pattern as project-channel.ts — pre-register one Supabase
//   listener per known event type before `channel.subscribe()`, then
//   fan out to JS-level subscribers added by `on(...)`. Lets consumers
//   safely add listeners AFTER the channel has joined.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeBrowserClient } from "./supabase-browser";
import {
  realtimePrivateMode,
  getRealtimeAccessToken,
} from "./token-manager";

// Broadcast event names — typed union so emitters + consumers agree
// on the wire format. Add new entries here BEFORE emitting them; the
// pre-registered Supabase listener for each entry needs to exist
// before the channel subscribes (the on/subscribe ordering rule).
export type UserBroadcastEvent =
  | "notification.created"
  | "share.revoked"
  | "credit.balance.changed"
  | "subscription.changed";

const USER_BROADCAST_EVENTS: readonly UserBroadcastEvent[] = [
  "notification.created",
  "share.revoked",
  "credit.balance.changed",
  "subscription.changed",
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
  // POINTER-ONLY, like credit.balance.changed - the Subscription MIRROR
  // (status / cancelAtPeriodEnd / currentPeriodEnd) changed. Consumers
  // (ManageBilling, BillingSection) refetch the auth-gated
  // GET /api/billing/summary; billing state never rides the socket. Emitted
  // by the cancel/resume routes + the Stripe webhook's mirror-changing
  // handlers (payment_failed / subscription.updated / .deleted / grant).
  "subscription.changed": Record<string, never>;
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
 *
 * Async since the private-channel hardening: the first open per tab
 * round-trips /api/realtime/token to learn whether private mode is on
 * (and to warm the token the socket will present at join).
 */
export async function openUserChannel(
  supabaseUserId: string,
): Promise<UserChannelHandle> {
  if (!supabaseUserId || typeof supabaseUserId !== "string") {
    throw new Error("[realtime] openUserChannel: supabaseUserId is required");
  }
  // Resolve the rollout mode BEFORE creating the channel - `private`
  // is part of the join, not toggleable afterwards. Public fallback
  // (secret not configured server-side) keeps pre-hardening behaviour.
  const isPrivate = await realtimePrivateMode();
  const client = getRealtimeBrowserClient();
  // Private joins are authorized AT join time, so the socket must
  // already carry the minted token - push it via setAuth BEFORE
  // subscribe (the `accessToken` client option alone doesn't reliably
  // feed the realtime socket for the first join; verified empirically).
  if (isPrivate) {
    const token = await getRealtimeAccessToken();
    if (token) await client.realtime.setAuth(token);
  }
  const topic = `user:${supabaseUserId}`;

  const channel = client.channel(topic, {
    config: {
      // Don't echo our own broadcasts. This is mostly belt-and-
      // suspenders — only the SERVER writes to this topic, but the
      // self-flag costs nothing.
      broadcast: { self: false, ack: false },
      private: isPrivate,
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
    "subscription.changed": [],
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
