"use client";

// Per-user notification store. Lightweight subscribe/notify pattern (no
// dep added); React components consume via the `useNotifications` hook
// (uses `useSyncExternalStore`). State is persisted to localStorage keyed
// by the authed Supabase user id so multi-account use on the same browser
// doesn't merge.
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
  // Reference cache so `useSyncExternalStore` can compare snapshots by
  // identity. We only return a new array reference when the list mutates.
  private snapshot: Notification[] = [];

  setUser(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    this.load();
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
