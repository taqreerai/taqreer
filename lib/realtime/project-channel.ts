// Project-scoped Supabase Realtime channel helper.
//
// Each project has ONE topic — `project:{projectId}` — that carries:
//   • Presence  — who's online + which slide they're focused on +
//                 whether their tab is active.
//   • Broadcast — server-emitted events fired after Prisma writes
//                 (comment.created, slide.regen.started, etc.). Payloads
//                 carry only POINTERS (commentId, slideId, actorUserId);
//                 clients dereference via REST routes that are already
//                 gated by `resolveProjectAccess`.
//
// Why broadcast (not Postgres Changes)?
//   Per `project_local_dev.md` our app data lives in docker-compose
//   Postgres at localhost:5432. Supabase Postgres is auth + storage
//   only — Supabase Realtime cannot subscribe to Postgres Changes on
//   our tables because they're in a database it can't see. Broadcast
//   over a socket works fine because it's just a socket service; the
//   database is irrelevant to it.
//
// Subscribe ordering:
//   Supabase requires every `channel.on(...)` call to happen BEFORE
//   `channel.subscribe()`. Consumers, though, register listeners
//   AFTER they get the handle. We work around this by pre-registering
//   ONE internal dispatch listener for each known event type at
//   `openProjectChannel` time (before subscribe), and exposing
//   `on()` / `onPresenceSync()` as JS-level fan-outs over local
//   subscriber arrays. The Supabase listener count stays fixed; the
//   number of JS subscribers per event grows freely without touching
//   the channel's subscribe state.

import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";
import { getRealtimeBrowserClient } from "./supabase-browser";
import {
  realtimePrivateMode,
  getRealtimeAccessToken,
} from "./token-manager";

// What we put on the wire for presence. Keep this minimal — every key
// here goes across the socket on every viewer's tab.
export type PresenceViewer = {
  // The PRISMA user id (not the Supabase auth id) so it matches
  // Comment.authorId / ProjectShare.userId / Notification.recipientUserId
  // — anything the bell or canvas needs to cross-reference is by prisma id.
  userId: string;
  // Display name. Falls back to "غير معروف" client-side if absent.
  name: string | null;
  // Avatar URL (User.image). null = render initial fallback.
  avatar: string | null;
  // 0-indexed slide the viewer is currently focused on. Drives the
  // avatar's position in SlideNavSidebar.
  slideIndex: number;
  // false = tab hidden (document.visibilityState === "hidden"). Drives
  // the dim. Updated on `visibilitychange`.
  tabActive: boolean;
};

// Broadcast event names — kept here as a typed union so consumers and
// emitters agree on the wire format. New events MUST be added here
// before being emitted (the constructor pre-registers a Supabase
// listener for every entry in BROADCAST_EVENTS so the lazy-subscribe
// pattern works without re-opening channels).
export type ProjectBroadcastEvent =
  | "comment.created"
  | "comment.deleted"
  | "slide.regen.started"
  | "slide.regen.finished"
  | "deck.regen.started"
  | "deck.regen.finished"
  // Per-slide lock toggle fired by /slides/[slideKey]/lock. Single
  // slide pulse — bulk lock/unlock uses `slides.locks.bulk-changed`
  // to avoid spamming N broadcasts when the user lock-alls a 20-slide
  // deck.
  | "slide.lock.changed"
  // Bulk lock-all / unlock-all from /slides/lock-all. Single event
  // applies to every slide in the deck — clients flip their entire
  // slideStates map's `lockedAt` to a fresh timestamp (when
  // `allLocked: true`) or null (when false).
  | "slides.locks.bulk-changed"
  // Images-mode (context/images.md): a reserved image box was filled by
  // gpt-image-2. Fired per image by deck-image-warm DURING generation
  // (and by regenerate later), so the client swaps the box's placeholder
  // → the real image live, while the deck is still streaming.
  | "slide.image.ready"
  // Images-mode: a reserved image box's generation FAILED permanently
  // (typically an OpenAI safety/copyright rejection of the prompt). The
  // client swaps the box's shimmer → a "generation failed, retry" state
  // instead of an eternal loading placeholder.
  | "slide.image.failed"
  // Frame decks (context/frame-architecture-2026-07-10.md): the freeze
  // bake finished - vision revisions applied, wells frozen, bake markers
  // stamped. Pointer-only: clients fat-sync the manifest, which swaps any
  // revised slides in place and clears the draft chips (they derive from
  // the markers).
  | "deck.baked"
  // GenChat LIVE tick: the bake pushed feed entries (review ask, live
  // review thinking, verdicts, per-slide outcomes). Carries the feed
  // itself (thumbs stripped for the wire) so the studio's chat updates
  // the moment the server writes, not on the next poll.
  | "deck.genchat";

const BROADCAST_EVENTS: readonly ProjectBroadcastEvent[] = [
  "comment.created",
  "comment.deleted",
  "slide.regen.started",
  "slide.regen.finished",
  "deck.regen.started",
  "deck.regen.finished",
  "slide.lock.changed",
  "slides.locks.bulk-changed",
  "slide.image.ready",
  "slide.image.failed",
  "deck.baked",
  "deck.genchat",
];

// Wire payload shapes. Server-broadcast helper enforces the same shapes.
export type ProjectBroadcastPayloadMap = {
  "comment.created": {
    commentId: string;
    slideId: string;
    actorPrismaUserId: string | null;
  };
  "comment.deleted": {
    commentId: string;
    slideId: string;
    actorPrismaUserId: string | null;
  };
  "slide.regen.started": {
    slideId: string;
    actorPrismaUserId: string | null;
  };
  "slide.regen.finished": {
    slideId: string;
    actorPrismaUserId: string | null;
  };
  "deck.regen.started": {
    actorPrismaUserId: string | null;
  };
  "deck.regen.finished": {
    actorPrismaUserId: string | null;
  };
  "slide.lock.changed": {
    slideKey: string;
    // ISO timestamp when newly locked, null when unlocked.
    lockedAt: string | null;
    actorPrismaUserId: string | null;
  };
  "slides.locks.bulk-changed": {
    // Applies to every slide in the deck.
    //   true  → set lockedAt to the broadcast's `lockedAt` field
    //   false → clear lockedAt on every row
    allLocked: boolean;
    // ISO timestamp the server used as the bulk lock-at value.
    // Null when allLocked is false (no point sending a timestamp
    // for unlock). Clients trust this rather than minting their own
    // so the value matches what's persisted server-side.
    lockedAt: string | null;
    actorPrismaUserId: string | null;
  };
  "slide.image.ready": {
    // The slide whose box was filled (== slide.slideId / SlideState key).
    slideKey: string;
    // data-genid of the filled box — the client finds the matching
    // <img data-genid> and sets its src.
    genid: string;
    // Permanent public URL of the generated image.
    url: string;
  };
  "slide.image.failed": {
    // The slide whose box failed (== slide.slideId / SlideState key).
    slideKey: string;
    // data-genid of the failed box — the client finds the matching
    // <img data-genid> and shows the failed/retry state.
    genid: string;
  };
  "deck.baked": {
    // The PresentationVersion the bake wrote.
    versionId: string;
    // Slides the vision pass revised (visuals changed). Informational —
    // the fat-sync refetch is what actually swaps the content.
    revisedSlideIds: string[];
  };
  "deck.genchat": {
    versionId: string;
    // The current feed (bounded, thumbs stripped for the wire — the poll /
    // fat-sync path carries the full entries). Client-validated per entry.
    entries: unknown[];
  };
};

export type ProjectChannelHandle = {
  // Underlying RealtimeChannel for advanced use. Most callers should
  // not need this — prefer the typed helpers below.
  channel: RealtimeChannel;
  // Subscribe to a typed broadcast event. Adds a JS-level callback —
  // safe to call any time, even after channel.subscribe() has fired.
  on: <E extends ProjectBroadcastEvent>(
    event: E,
    handler: (payload: ProjectBroadcastPayloadMap[E]) => void,
  ) => void;
  // Subscribe to presence sync. Called on every join/leave/sync from
  // the underlying channel. Receives the FULL current state (clients
  // figure out diffs themselves).
  onPresenceSync: (handler: (state: ViewerPresence) => void) => void;
  // Update our own presence payload. The channel must be SUBSCRIBED
  // before `track` works; the helper waits up to 3s for that.
  track: (viewer: PresenceViewer) => Promise<void>;
  // Close + remove this channel. Idempotent.
  close: () => Promise<void>;
};

// What we expose to consumers from presence — a normalised map of
// viewerId → PresenceViewer, derived from RealtimePresenceState.
export type ViewerPresence = Record<string, PresenceViewer>;

/**
 * Open a fresh project channel and start its subscription. Each
 * caller gets its own channel — they multiplex over the same socket.
 *
 * @param projectId Project the channel is scoped to.
 * @param presenceKey UNIQUE identifier for this viewer (prisma User.id).
 *   Used as the Supabase presence key — Supabase groups metas by key,
 *   so this MUST be unique per concurrent viewer (otherwise their
 *   presence entries collide into a single bucket and the dispatcher
 *   only sees the most-recent meta). Pass `null` for broadcast-only
 *   consumers (e.g. anonymous public-view) that don't track presence.
 *
 * Caller responsibilities:
 *  - Call `ensureProjectTopic(projectId)` (token-manager) BEFORE this,
 *    so the minted token already lists the project topic at join time.
 *  - Call `close()` on cleanup (e.g. component unmount).
 *  - Call `track({...})` after the channel joins to broadcast your
 *    presence; subsequent track calls update the payload.
 *
 * Async since the private-channel hardening: the first open per tab
 * round-trips /api/realtime/token to learn whether private mode is on.
 */
export async function openProjectChannel(
  projectId: string,
  presenceKey: string | null,
): Promise<ProjectChannelHandle> {
  if (!projectId || typeof projectId !== "string") {
    throw new Error("[realtime] openProjectChannel: projectId is required");
  }
  // `private` is part of the join - resolve the rollout mode first.
  const isPrivate = await realtimePrivateMode();
  const client = getRealtimeBrowserClient();
  // Push the minted token to the socket BEFORE subscribe - private
  // joins authorize at join time and the `accessToken` option alone
  // doesn't reliably feed the first join (verified empirically). The
  // token's `topics` claim must already include this project (the
  // caller runs `ensureProjectTopic` first).
  if (isPrivate) {
    const token = await getRealtimeAccessToken();
    if (token) await client.realtime.setAuth(token);
  }
  const topic = `project:${projectId}`;

  // A prior open for this topic may not have finished tearing down: the React
  // effect cleanup calls close() (an async removeChannel) WITHOUT awaiting it,
  // then re-runs synchronously when a dep changes (e.g. a profile / locale
  // PATCH). Supabase's client.channel() dedupes by topic, so it would hand us
  // back that STALE, already-subscribed channel, and adding presence .on()
  // listeners to a subscribed channel throws ("cannot add `presence` callbacks
  // ... after `subscribe()`"). Remove any leftover channel for this topic
  // first so we always bind + subscribe a fresh one.
  const existing = client
    .getChannels()
    .find((c) => c.topic === `realtime:${topic}`);
  if (existing) {
    try {
      await client.removeChannel(existing);
    } catch {
      // best-effort: a failed remove still lets the fresh bind proceed
    }
  }

  const channel = client.channel(topic, {
    config: {
      // Don't echo our own broadcasts back to us — every emitter
      // already knows what it sent.
      broadcast: { self: false, ack: false },
      private: isPrivate,
      // Per-viewer presence key. Supabase uses this to bucket metas;
      // empty / shared keys collide everybody's presence into one
      // bucket and the dispatcher only sees the most-recent meta —
      // the classic "I can see them but they can't see me" symptom.
      // Fallback to a random per-tab id for broadcast-only consumers
      // so the channel still works; they just won't track presence.
      presence: {
        key:
          presenceKey ??
          (typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `anon-${Math.random().toString(36).slice(2)}`),
      },
    },
  });

  // JS-level subscriber registries — populated by `on()` / `onPresenceSync()`
  // after the channel is already subscribed. The Supabase-side
  // listeners registered below dispatch into these arrays.
  type BroadcastSubscribers = {
    [E in ProjectBroadcastEvent]: Array<
      (payload: ProjectBroadcastPayloadMap[E]) => void
    >;
  };
  const broadcastSubscribers: BroadcastSubscribers = {
    "comment.created": [],
    "comment.deleted": [],
    "slide.regen.started": [],
    "slide.regen.finished": [],
    "deck.regen.started": [],
    "deck.regen.finished": [],
    "slide.lock.changed": [],
    "slides.locks.bulk-changed": [],
    "slide.image.ready": [],
    "slide.image.failed": [],
    "deck.baked": [],
    "deck.genchat": [],
  };
  const presenceSubscribers: Array<(state: ViewerPresence) => void> = [];

  // Pre-register ONE Supabase listener per broadcast event name so we
  // never need to add listeners after subscribe(). Each one fans the
  // payload out to the JS-level subscriber array.
  for (const event of BROADCAST_EVENTS) {
    channel.on(
      "broadcast" as unknown as never,
      { event } as never,
      ((msg: { event: string; payload: unknown; type: string }) => {
        // Cast through `never` — payloads are typed by the emitter
        // (`broadcastToProject` enforces ProjectBroadcastPayloadMap[E]).
        const subs = broadcastSubscribers[event];
        for (const sub of subs) {
          sub(msg.payload as never);
        }
      }) as never,
    );
  }

  // Pre-register presence listeners. All three (sync/join/leave) call
  // the same dispatcher — consumers always get the FULL current state,
  // not a diff.
  const presenceDispatcher = () => {
    const raw =
      channel.presenceState() as unknown as RealtimePresenceState<PresenceViewer>;
    const flat: ViewerPresence = {};
    for (const [key, metas] of Object.entries(raw)) {
      const last = metas[metas.length - 1];
      if (!last) continue;
      flat[key] = {
        userId: last.userId,
        name: last.name ?? null,
        avatar: last.avatar ?? null,
        slideIndex: typeof last.slideIndex === "number" ? last.slideIndex : 0,
        tabActive: last.tabActive !== false,
      };
    }
    for (const sub of presenceSubscribers) {
      sub(flat);
    }
  };
  channel.on(
    "presence" as unknown as never,
    { event: "sync" } as never,
    presenceDispatcher as never,
  );
  channel.on(
    "presence" as unknown as never,
    { event: "join" } as never,
    presenceDispatcher as never,
  );
  channel.on(
    "presence" as unknown as never,
    { event: "leave" } as never,
    presenceDispatcher as never,
  );

  // Now safe to subscribe — every Supabase listener is in place.
  channel.subscribe();

  const handle: ProjectChannelHandle = {
    channel,
    on(event, handler) {
      // `handler` is typed over E but the registry stores them in
      // event-keyed arrays of slightly varying parameter types. Cast
      // through `never` is safe — the dispatcher pulls from the same
      // event-keyed bucket, so the payload type always matches.
      (broadcastSubscribers[event] as Array<typeof handler>).push(handler);
    },
    onPresenceSync(handler) {
      presenceSubscribers.push(handler);
      // If presence is already established (e.g. caller subscribed
      // after sync arrived) fire once with the current state so they
      // don't wait for the next join/leave.
      if (channel.state === "joined") {
        const raw =
          channel.presenceState() as unknown as RealtimePresenceState<PresenceViewer>;
        if (Object.keys(raw).length > 0) presenceDispatcher();
      }
    },
    async track(viewer) {
      // Supabase requires subscribe() to have resolved before track().
      // The channel may be SUBSCRIBED or still SUBSCRIBING — poll briefly.
      // Break early on terminal states (`errored`, `closed`) so a
      // failed subscribe doesn't burn the full 3 s before giving up.
      const TERMINAL_STATES = ["errored", "closed"];
      const start = Date.now();
      while (
        channel.state !== "joined" &&
        !TERMINAL_STATES.includes(channel.state) &&
        Date.now() - start < 3000
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (channel.state !== "joined") {
        // Don't throw — presence is non-critical; just log + skip so
        // the UI keeps working with broadcasts only.
        console.warn(
          "[realtime] track() skipped — channel not joined",
          { topic, state: channel.state },
        );
        return;
      }
      await channel.track(viewer);
    },
    async close() {
      try {
        await channel.untrack();
      } catch {
        // ignore — supabase no-ops if not tracked
      }
      await client.removeChannel(channel);
    },
  };

  return handle;
}
