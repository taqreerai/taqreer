"use client";

// Per-user notification store. Lightweight subscribe/notify pattern (no
// dep added); React components consume via the `useNotifications` hook
// (uses `useSyncExternalStore`).
//
// Two sources of items, both flowing through the same shape:
//   1. SERVER-backed (Phase 16.E, 2026-05-24) — fetched from
//      /api/notifications on setUser, with live arrivals pushed in via
//      the user-scoped Supabase channel (`user:{prismaUserId}`). The
//      server already formats them into the bell row shape.
//   2. CLIENT-only — pushed locally by code paths that produce
//      transient toasts (DeckView's apply-poller error path, comment
//      failure toasts, etc.) via `push()`. These never leave the
//      browser; localStorage caches them across reloads.
//
// Both source types coexist in one in-memory list. Server items are
// keyed by their cuid id; client items by `n_*`. Hydrate from server
// upserts by id without removing client-only items.
//
// Caps:
//   - List length max 30 (oldest dropped on push)
//   - Bell dropdown shows top 5 (UI-layer concern)
//
// SSR-safety: localStorage access is guarded by `typeof window !==
// "undefined"`. The hook below provides an empty-array snapshot on the
// server so first-paint markup matches what the client renders before
// the load() pass runs in an effect.

import { useSyncExternalStore } from "react";
import {
  openUserChannel,
  type UserChannelHandle,
} from "@/lib/realtime/user-channel";

export type NotificationKind =
  | "error"
  | "warning"
  | "info"
  | "success"
  | "promo";

export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  desc?: string;
  // If set, the item is clickable in the UI and navigates here on click
  // (also marks the item as read). Useful for "your deck failed" →
  // /preview/<projectId>.
  href?: string;
  // ISO timestamp captured at push time. Display formatter renders this
  // as Latin-digit HH:mm for "today" items and DD/MM HH:mm otherwise.
  createdAt: string;
  read: boolean;
};

export type NotificationInput = Omit<Notification, "id" | "createdAt" | "read"> & {
  read?: boolean;
};

const MAX_NOTIFICATIONS = 30;
const STORAGE_PREFIX = "taqreer:notifications:";

type Listener = () => void;

function generateId(): string {
  // Notifications don't leave the client so a non-crypto id is fine; we
  // only need uniqueness within a single user's list of ≤30. ISO time +
  // a short random suffix gives collision-free ids even on rapid pushes.
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class NotificationStore {
  private items: Notification[] = [];
  private listeners = new Set<Listener>();
  // userId is the SUPABASE user id (UUID). Until setUser fires, items
  // resolves to `[]` and pushes are dropped silently — no point storing
  // notifications for an unknown user.
  private userId: string | null = null;
  // Prisma user id (cuid). Distinct from `userId` (Supabase auth id)
  // because the bell's REST routes + the user-channel topic both key
  // on Prisma id. Set by the setUser caller along with the supabase id.
  private prismaUserId: string | null = null;
  // Reference cache so `useSyncExternalStore` can compare snapshots by
  // identity. We only return a new array reference when the list mutates.
  private snapshot: Notification[] = [];
  // Open user-scoped Supabase channel. One per active user; closed +
  // re-opened on user change so the channel topic always matches the
  // recipient currently signed in.
  private channel: UserChannelHandle | null = null;
  // Concurrency guard for the post-setUser fetch + channel-driven
  // single-row fetches. If a prior fetch is in flight when the user
  // changes (rare but possible: rapid login → logout), the older
  // promise's resolution gets discarded by comparing against the
  // current `userId`. Without this guard a stale fetch could
  // hydrate the new user with the previous account's notifications.
  private fetchAbort: AbortController | null = null;

  setUser(userId: string | null, prismaUserId: string | null = null): void {
    if (this.userId === userId && this.prismaUserId === prismaUserId) return;
    // Tear down the prior user's live channel before swapping caches.
    // Async close is fire-and-forget; the realtime client lets us open
    // a new channel on a different topic immediately, and the old one
    // disconnects on its own timeline.
    if (this.channel) {
      this.channel.close().catch(() => {
        /* socket already torn down — fine */
      });
      this.channel = null;
    }
    if (this.fetchAbort) {
      this.fetchAbort.abort();
      this.fetchAbort = null;
    }
    this.userId = userId;
    this.prismaUserId = prismaUserId;
    this.load();
    // Open the new user's channel + hydrate from server. Skipped when
    // logging out (userId / prismaUserId null) or pre-hydration. The
    // hydrate path is what surfaces unread items the user accrued
    // while offline (multi-device, page reload, etc.).
    if (typeof window !== "undefined" && this.prismaUserId) {
      this.openChannelForCurrentUser();
      this.hydrateFromServer();
    }
  }

  private storageKey(): string | null {
    return this.userId ? `${STORAGE_PREFIX}${this.userId}` : null;
  }

  private load(): void {
    const key = this.storageKey();
    if (!key || typeof window === "undefined") {
      this.items = [];
      this.snapshot = [];
      this.emit();
      return;
    }
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as Notification[]) : [];
      this.items = Array.isArray(parsed) ? parsed.slice(0, MAX_NOTIFICATIONS) : [];
    } catch {
      this.items = [];
    }
    this.snapshot = [...this.items];
    this.emit();
  }

  // Subscribes to the recipient's user channel for live notifications.
  // The channel pushes pointer-only payloads ({ notificationId }); the
  // handler fetches the full formatted row via REST and upserts via
  // `pushFromServer`. Failures swallow silently — the row will land
  // on the next hydrate / visibility-regain regardless.
  private openChannelForCurrentUser(): void {
    if (!this.prismaUserId) return;
    try {
      const handle = openUserChannel(this.prismaUserId);
      handle.on("notification.created", (payload) => {
        // Capture the prismaUserId at handler-bind time so a later
        // user switch doesn't fetch into the wrong recipient's list.
        const recipientAtBind = this.prismaUserId;
        if (!payload?.notificationId) return;
        (async () => {
          try {
            const res = await fetch(
              `/api/notifications?ids=${encodeURIComponent(payload.notificationId)}`,
              { credentials: "same-origin" },
            );
            if (!res.ok) return;
            if (this.prismaUserId !== recipientAtBind) return;
            const data = (await res.json()) as { notifications?: Notification[] };
            const row = data.notifications?.[0];
            if (row) this.pushFromServer(row);
          } catch {
            /* network blip — caught on next hydrate */
          }
        })();
      });
      this.channel = handle;
    } catch (err) {
      console.warn("[notifications] openUserChannel failed", err);
    }
  }

  // Fetches the user's last 50 notifications and merges them in by
  // id. Client-only items (those with ids not in the server response)
  // are preserved — they're transient toasts that never made it to
  // the DB. Newest-first by createdAt, capped at MAX_NOTIFICATIONS.
  private async hydrateFromServer(): Promise<void> {
    if (typeof window === "undefined") return;
    const recipientAtStart = this.prismaUserId;
    const controller = new AbortController();
    this.fetchAbort = controller;
    try {
      const res = await fetch("/api/notifications", {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!res.ok) return;
      if (this.prismaUserId !== recipientAtStart) return;
      const data = (await res.json()) as { notifications?: Notification[] };
      const server = Array.isArray(data.notifications) ? data.notifications : [];
      // Upsert by id: server rows replace any local row with the same
      // id, additions get added, client-only items stay.
      //
      // The `read` flag is treated as STICKY ONCE TRUE — if the local
      // row was already marked read, that local truth wins over the
      // server's current state. This guards the race where the user
      // marks-all-read optimistically (`markAllRead` flips local
      // `read: true` immediately) but the page reloads / re-hydrates
      // BEFORE the fire-and-forget `/api/notifications/read-all` POST
      // lands. Without this guard, the next hydrate would re-fetch
      // the server's stale `readAt: null` rows and clobber the
      // optimistic local true → user sees "old notifications as
      // unread again." The app has no "mark unread" action, so
      // sticky-true is safe (server can only confirm read, never
      // un-set it).
      const byId = new Map<string, Notification>();
      for (const item of this.items) byId.set(item.id, item);
      for (const row of server) {
        const local = byId.get(row.id);
        byId.set(
          row.id,
          local ? { ...row, read: row.read || local.read } : row,
        );
      }
      const merged = [...byId.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_NOTIFICATIONS);
      this.items = merged;
      this.snapshot = [...this.items];
      this.persist();
      this.emit();
    } catch (err) {
      // AbortError on user switch is expected; everything else logs.
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "AbortError"
      ) {
        return;
      }
      console.warn("[notifications] hydrateFromServer failed", err);
    } finally {
      if (this.fetchAbort === controller) this.fetchAbort = null;
    }
  }

  private persist(): void {
    const key = this.storageKey();
    if (!key || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(this.items));
    } catch {
      /* quota / disabled storage — best-effort persistence */
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot = (): Notification[] => this.snapshot;

  push(input: NotificationInput): void {
    if (!this.userId) return;
    const n: Notification = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      read: input.read ?? false,
      kind: input.kind,
      title: input.title,
      desc: input.desc,
      href: input.href,
    };
    // Newest first; cap at MAX (drop oldest).
    this.items = [n, ...this.items].slice(0, MAX_NOTIFICATIONS);
    this.snapshot = [...this.items];
    this.persist();
    this.emit();
  }

  // Upsert a server-formatted notification into the list. Used by the
  // user-channel handler (live arrivals) AND any future code that
  // wants to inject a pre-formatted server row. Deduped by id: a
  // later push with the same id wins, which lets re-broadcasts after
  // a merge update the existing row instead of duplicating it.
  pushFromServer(row: Notification): void {
    if (!this.userId) return;
    const idx = this.items.findIndex((x) => x.id === row.id);
    if (idx === -1) {
      this.items = [row, ...this.items].slice(0, MAX_NOTIFICATIONS);
    } else {
      // Same sticky-once-true rule as hydrateFromServer — a re-pushed
      // row (e.g. broadcast re-fire after a merge) must not flip a
      // locally-read row back to unread.
      const existing = this.items[idx];
      const next = [...this.items];
      next[idx] = { ...row, read: row.read || existing.read };
      // Re-sort if the server bumped createdAt (merge path).
      next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.items = next.slice(0, MAX_NOTIFICATIONS);
    }
    this.snapshot = [...this.items];
    this.persist();
    this.emit();
  }

  // Marks every local row as read (optimistic) and fires the server
  // mark-all-read in the background. "All-read on bell open" per the
  // product decision — the user opens the bell to acknowledge the
  // accumulated activity, regardless of which row they actually
  // click through. Client-only items (warnings / errors with `n_*`
  // ids) are also marked read locally; the server call is a no-op
  // for them since they were never persisted.
  markAllRead(): void {
    const hasUnread = this.items.some((x) => !x.read);
    if (hasUnread) {
      this.items = this.items.map((x) => (x.read ? x : { ...x, read: true }));
      this.snapshot = [...this.items];
      this.persist();
      this.emit();
    }
    if (this.prismaUserId && typeof window !== "undefined") {
      // Fire-and-forget — the optimistic local flip is the visible
      // state. A server failure leaves the local items read; they'll
      // re-hydrate as read once the server eventually accepts the
      // call, or the user will see them as unread again on next
      // hydrate after a successful server-side change. Acceptable.
      fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {
        /* network blip — local read state stays */
      });
    }
  }

  remove(id: string): void {
    const next = this.items.filter((x) => x.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.snapshot = [...this.items];
    this.persist();
    this.emit();
  }

  clearAll(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.snapshot = [];
    this.persist();
    this.emit();
  }

  markRead(id: string): void {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx === -1 || this.items[idx].read) return;
    this.items = this.items.map((x) => (x.id === id ? { ...x, read: true } : x));
    this.snapshot = [...this.items];
    this.persist();
    this.emit();
  }
}

// Module-singleton — survives Fast Refresh because Next reuses the
// existing module instance. Components import the singleton directly.
export const notificationStore = new NotificationStore();

// Dev-only console handle. Exposes the singleton on
// `window.__taqreer_notif` so you can fire test notifications from
// the DevTools console without spinning up a real broadcast event.
// Gated on NODE_ENV so production never carries the global. Example:
//   window.__taqreer_notif.push({
//     kind: "info",
//     title: "اختبار",
//     desc: "نص طويل…",
//   });
if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV !== "production"
) {
  (window as unknown as { __taqreer_notif?: NotificationStore }).__taqreer_notif =
    notificationStore;
}

// Server snapshot — empty list. SSR ↔ first-client-render must agree on
// markup; loading from localStorage only happens in an effect after the
// store knows the user id.
const EMPTY_SNAPSHOT: Notification[] = [];
const ssrSnapshot = (): Notification[] => EMPTY_SNAPSHOT;

export function useNotifications(): Notification[] {
  return useSyncExternalStore(
    (listener) => notificationStore.subscribe(listener),
    notificationStore.getSnapshot,
    ssrSnapshot,
  );
}

// Convenience: format ISO timestamp as Latin-digit HH:mm for "today",
// DD/MM HH:mm for other days within the current year, and DD/MM/YY HH:mm
// otherwise. All digits Latin per the brand rule.
export function formatNotificationTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const sameYear = date.getFullYear() === now.getFullYear();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  if (sameDay) return `${hh}:${mm}`;
  const dd = pad(date.getDate());
  const mo = pad(date.getMonth() + 1);
  if (sameYear) return `${dd}/${mo} ${hh}:${mm}`;
  const yy = pad(date.getFullYear() % 100);
  return `${dd}/${mo}/${yy} ${hh}:${mm}`;
}
