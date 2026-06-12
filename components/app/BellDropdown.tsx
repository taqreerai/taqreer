"use client";

// Header bell + notification popover.
//
// Visual language: surface-card popover (matches `.surface-modal` blur) anchored
// below the bell button. Top 5 items shown; footer has "See all" → opens
// the AllNotificationsModal, and "Clear all" → wipes the store.
//
// Per-item layout follows the morphin reference: tinted-square icon on
// the start side, title + truncated desc in the middle, timestamp on
// the end. Unread items have a small blue dot before the title.
//
// Auth wiring: on mount we read the supabase user via the browser client
// and feed it into the notification store so it knows where to load /
// persist. Switching accounts in the same tab will swap the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  formatNotificationTime,
  notificationStore,
  useNotifications,
  type Notification,
  type NotificationKind,
} from "@/lib/notifications/store";
import { AllNotificationsModal } from "@/components/app/AllNotificationsModal";
import { notificationIcon } from "@/lib/notifications/visuals";

const TOP_N = 5;

// Toast slot height (px) = approximate notification row height + 8 px
// gap. Used to compute each toast's `y` from its index when stacking.
// Keep in sync with NotificationRow's compact={false} padding.
const TOAST_SLOT_HEIGHT = 84;

// New-notification freshness window — notifications older than this
// when they arrive in `items` don't pop a toast (they've been seen
// in the bell already on a previous mount).
const TOAST_FRESHNESS_MS = 5_000;

// Auto-dismiss each toast after this many ms. User can close earlier
// via the X. Stack is also capped at 3 (see TOP_N usage above) so
// the 4th arrival evicts the oldest.
const TOAST_AUTO_DISMISS_MS = 15_000;

// Gap (px) between the bell's bottom edge and the top of the
// popover. Tuned so the popover floats clear of the header chrome.
const BELL_ANCHOR_GAP_PX = 25;

// Popover / toast column geometry — both surfaces are a fixed 320 px
// wide (w-80) and centred under the bell's `centerX`. Kept here so the
// left math below reads from named constants.
const POPOVER_WIDTH_PX = 320;
const VIEWPORT_GUTTER_PX = 12;

// Physical `left` for the popover / toast column.
//
// `centerX` is the bell's screen-space x (from getBoundingClientRect), so it
// already encodes the trigger's real on-screen position in BOTH directions —
// in RTL the bell sits at the visual left and centerX is small; in LTR it sits
// at the right and centerX is large. Centring the 320 px column on it
// (`centerX - 160`) hangs it under the trigger either way; the popover's own
// `dir={dir}` handles the internal layout. Do NOT mirror centerX in RTL —
// `viewportWidth - centerX` would fling the column to the opposite side of the
// screen, away from the bell (CR #55). Just clamp into the 12 px gutters.
function popoverLeft(centerX: number, viewportWidth: number): number {
  const maxLeft = viewportWidth - POPOVER_WIDTH_PX - VIEWPORT_GUTTER_PX;
  const centred = centerX - POPOVER_WIDTH_PX / 2;
  return Math.max(VIEWPORT_GUTTER_PX, Math.min(centred, maxLeft));
}

export function BellDropdown({ headless = false }: { headless?: boolean } = {}) {
  const dict = useDict();
  const { dir, locale } = useLocale();
  const router = useRouter();
  // Hide "deck finished" from the BELL only (its list, its toast pop, AND the
  // unread badge — all derive from `items` below). For images decks it fires
  // while the images are still rendering, so it's premature/misleading here.
  // The row still lives in the store, so the dashboard Recent Activity widget
  // (which reads the same `useNotifications()` UNFILTERED) keeps showing it.
  const allItems = useNotifications();
  const items = useMemo(
    () => allItems.filter((n) => n.type !== "deck.generate.finished"),
    [allItems],
  );
  const [open, setOpen] = useState(false);
  const [seeAllOpen, setSeeAllOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  // Bell's bounding rect — captured when the popover opens so we can
  // portal the popover to <body> at the right screen-space coordinates.
  // Portaling is necessary: the header has its own backdrop-filter, which
  // creates a stacking context that traps the popover's backdrop-filter
  // (the popover would only blur the header's content, not the page).
  // Portaling lifts the popover out so its blur actually sees the page.
  const [bellRect, setBellRect] = useState<{
    top: number;
    centerX: number;
  } | null>(null);
  const [bodyMounted, setBodyMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyMounted(true);
  }, []);

  // Toast state hoisted above the measure effect so the effect can read
  // `toasts.length` without a TDZ violation.
  const [toasts, setToasts] = useState<Notification[]>([]);
  // Tracks `id → createdAt` (NOT `Set<id>`) so a re-broadcast of an
  // EXISTING notification with a newer createdAt (server-side grouping
  // window merges a second event into the same row) re-pops a toast.
  // Without the createdAt key, the 2nd / 3rd grouped comment from the
  // same actor within 10 min silently lands in the bell list without
  // any visible cue. Bug surfaced 2026-05-24 during PR #33 testing —
  // user added a 2nd comment from Safari and the toast didn't pop.
  const seenIdsRef = useRef<Map<string, string>>(new Map());
  // Per-toast 15 s auto-dismiss timers, keyed by notification id. Tracked
  // here (not as a local array inside the queue-effect) so a follow-up
  // notification arriving while earlier toasts are still on screen does
  // NOT cancel their timers via effect cleanup. Each toast owns its own
  // timer and lives out its full 15 s independent of what arrives next.
  const timersRef = useRef<Map<string, number>>(new Map());
  const dismissToast = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);
  // Clear any remaining timers on unmount so they don't fire into a
  // ghost component.
  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) window.clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  // Per-toast measured heights. Populated as each BellToast mounts +
  // observes itself with a ResizeObserver. Used to compute cumulative
  // `y` positions so (a) expanding the top toast pushes the toasts
  // beneath it DOWN by the height delta and (b) collapsed toasts
  // never slightly overlap from a too-short TOAST_SLOT_HEIGHT. Map
  // not object so set/delete order stays predictable. Empty entries
  // fall back to TOAST_SLOT_HEIGHT on first paint before the
  // ResizeObserver fires.
  const [toastHeights, setToastHeights] = useState<Map<string, number>>(
    () => new Map(),
  );
  const setToastHeight = useCallback((id: string, h: number) => {
    setToastHeights((prev) => {
      if (prev.get(id) === h) return prev;
      const next = new Map(prev);
      next.set(id, h);
      return next;
    });
  }, []);

  // Compute each toast's vertical offset based on the heights of the
  // toasts above it (plus a fixed gap between them). Unmeasured toasts
  // fall back to TOAST_SLOT_HEIGHT so the first paint before the
  // ResizeObserver fires still positions sensibly.
  const TOAST_GAP_PX = 8;
  const toastPositions = useMemo(() => {
    const out = new Map<string, number>();
    let cur = 0;
    for (const n of toasts) {
      out.set(n.id, cur);
      const h = toastHeights.get(n.id) ?? TOAST_SLOT_HEIGHT;
      cur += h + TOAST_GAP_PX;
    }
    return out;
  }, [toasts, toastHeights]);

  // Prune heights for toasts that no longer exist (post-dismiss).
  // Keeps the Map from growing forever across the session.
  useEffect(() => {
    // Guarded resync — returns `prev` when nothing changed, so no
    // cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToastHeights((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(toasts.map((t) => t.id));
      let dirty = false;
      const next = new Map<string, number>();
      for (const [id, h] of prev) {
        if (ids.has(id)) next.set(id, h);
        else dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [toasts]);

  // Re-measure the bell's screen position when the popover opens, when
  // toasts appear (so they can position correctly without requiring the
  // user to open the bell first), AND whenever the viewport
  // resizes/scrolls while either is visible.
  useEffect(() => {
    const needsRect = open || toasts.length > 0;
    if (!needsRect) return;
    const measure = () => {
      // Headless mode (dashboard pages post-§20: the bell button moved
      // into the sidebar profile menu, so there's no button to anchor
      // to). Toasts still fire — pin them to the top-START corner
      // (visual LEFT in RTL, clear of the right-hand sidebar). centerX
      // is chosen so the column's left math (`centerX - 160`) clamps to
      // the 12 px left gutter.
      if (headless) {
        setBellRect({ top: 24, centerX: 172 });
        return;
      }
      const el = bellRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // 25 px gap below the bell so the popover floats clear of the
      // header's bottom edge.
      setBellRect({
        top: rect.bottom + BELL_ANCHOR_GAP_PX,
        centerX: rect.left + rect.width / 2,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, toasts.length, headless]);

  // Dev-only console helper: run `__pushTestNotif()` in devtools to fire
  // a fresh notification (createdAt = now) so the toast layer can be
  // smoke-tested without waiting for a real generate/regen event. Spam
  // the call to verify stacking.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as {
      __pushTestNotif?: (kind?: NotificationKind) => void;
    };
    let counter = 0;
    w.__pushTestNotif = (kind: NotificationKind = "info") => {
      counter += 1;
      notificationStore.push({
        kind,
        title: dict.dialogs.notifications.devTestTitle.replace(
          "{counter}",
          String(counter),
        ),
        desc: dict.dialogs.notifications.devTestDesc,
      });
    };
    return () => {
      delete w.__pushTestNotif;
    };
  }, [dict]);

  // Wire the store to the current user once on mount. Without this the
  // store has no userId → push() drops silently and nothing appears
  // in the dropdown.
  //
  // Two ids handed to the store:
  //   • Supabase auth id — keys the localStorage cache (multi-account
  //     on the same browser doesn't merge).
  //   • Prisma user id — keys the user-scoped Supabase channel topic
  //     (`user:{prismaUserId}`) AND the server's notification table FK.
  //     Without it, live arrivals can't be subscribed to.
  //
  // We fetch the prisma id via /api/me in the same boot pass so the
  // setUser call lands once with both ids and the store doesn't have
  // to handle a mid-life upgrade. Anonymous / signed-out users skip
  // both calls — the store stays in its empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        const supabaseId = data.user?.id ?? null;
        if (!supabaseId) {
          notificationStore.setUser(null);
          return;
        }
        // Fetch prisma id. /api/me returns 204 for anonymous + a
        // shaped JSON body for authed; on a 204 the body is empty
        // so the parsed result is null.
        let prismaId: string | null = null;
        try {
          const meRes = await fetch("/api/me", { credentials: "same-origin" });
          if (meRes.ok) {
            const me = (await meRes.json()) as { prismaUserId?: string | null };
            prismaId = me.prismaUserId ?? null;
          }
        } catch {
          /* /api/me network blip — fall through with prismaId=null
             so the localStorage cache still works; the user channel
             just won't open until next mount. */
        }
        if (cancelled) return;
        notificationStore.setUser(supabaseId, prismaId);
      } catch {
        /* anonymous / not signed in — store stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Toast notifications — when a NEW notification (created within the
  // last 5 s) appears in the store, it pops up under the bell as a
  // surface-popover toast. Auto-dismisses after 15 s; user can close
  // early with the X. Stack capped at 3 — a 4th arrival keeps all 4
  // visible briefly so they slide down to their new slots, then
  // dismisses the oldest on the next frame so its exit animation
  // fades it out from the (now-shifted) bottom position.
  //
  // If the bell popover is already open, brand-new notifications go
  // straight into the popover's list (no toast machinery), so we just
  // mark them as seen and skip the rest.
  useEffect(() => {
    const now = Date.now();
    const queued: Notification[] = [];
    for (const n of items) {
      // Skip if we've already seen THIS exact (id, createdAt) tuple.
      // A re-broadcast that updates the row (grouping window merge)
      // bumps createdAt server-side, so the prior createdAt comparison
      // fails and we proceed to toast — exactly what we want.
      const prevCreatedAt = seenIdsRef.current.get(n.id);
      if (prevCreatedAt === n.createdAt) continue;
      seenIdsRef.current.set(n.id, n.createdAt);
      if (open) continue; // popover is showing them; no toast
      const age = now - new Date(n.createdAt).getTime();
      if (age > TOAST_FRESHNESS_MS) continue; // old persisted item — skip toast
      queued.push(n);
    }
    if (queued.length === 0) return;
    // Compute combined + overflow synchronously from the closure
    // `toasts` BEFORE calling setToasts. We can't read these from
    // inside the updater callback because React calls it later
    // (during render), at which point our follow-up rAF check would
    // run with stale empty values — that was the root cause of the
    // "stacks forever" bug.
    //
    // Dedupe by id: when a grouping re-broadcast re-pops a notification
    // whose toast is still on-screen, drop the stale toast (and its
    // timer) from the carry-forward set so the fresh one replaces it.
    // Without this, React would see two entries with the same `key`
    // and warn — and the new + old toasts would stack on top of each
    // other. The newer toast wins; the older's timer is cancelled.
    const queuedIds = new Set(queued.map((q) => q.id));
    const carriedToasts = toasts.filter((t) => {
      if (!queuedIds.has(t.id)) return true;
      const oldTimer = timersRef.current.get(t.id);
      if (oldTimer !== undefined) {
        window.clearTimeout(oldTimer);
        timersRef.current.delete(t.id);
      }
      return false;
    });
    const combined = [...queued, ...carriedToasts];
    const toEvict = combined.length > 3 ? combined.slice(3) : [];
    setToasts(combined);
    // Set per-toast timers, tracked by id in timersRef. NO cleanup that
    // bulk-cancels timers — each timer is owned by its toast and is
    // cancelled either when dismissToast runs (X click / overflow
    // eviction / popover open) or when the component unmounts.
    for (const n of queued) {
      const t = window.setTimeout(() => dismissToast(n.id), TOAST_AUTO_DISMISS_MS);
      timersRef.current.set(n.id, t);
    }
    if (toEvict.length > 0) {
      // One rAF for the layout shift to start; the exit animation then
      // overlaps with the tail end of the slide.
      requestAnimationFrame(() => {
        for (const e of toEvict) dismissToast(e.id);
      });
    }
    // `toasts` is intentionally read from closure here (not in deps)
    // so we don't loop on our own setToasts. Each items change picks
    // up the latest toasts via the render closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, open, dismissToast]);

  // Dismiss all toasts when the bell popover opens — notifications are
  // now visible in the dropdown, the toast is redundant.
  useEffect(() => {
    if (open && toasts.length > 0) {
      for (const t of timersRef.current.values()) window.clearTimeout(t);
      timersRef.current.clear();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToasts([]);
    }
  }, [open, toasts.length]);

  // Close on outside click + Escape. With the popover portal'd to body,
  // we tag it with `data-bell-popover` so the pointer handler can treat
  // it as "inside" the bell UI for purposes of dismissal.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const root = wrapperRef.current;
      if (!root) return;
      if (!(e.target instanceof Element)) return;
      const insideBell = root.contains(e.target);
      const insidePopover = !!e.target.closest("[data-bell-popover]");
      if (!insideBell && !insidePopover) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
  const visible = items.slice(0, TOP_N);

  const handleItemClick = useCallback(
    (n: Notification) => {
      notificationStore.markRead(n.id);
      if (n.href) {
        setOpen(false);
        // Server rows carry BARE app paths; prefix the active locale
        // (a raw push dropped the language).
        router.push(localizedHref(n.href, locale));
      }
    },
    [router, locale],
  );

  const handleClearAll = useCallback(() => {
    notificationStore.clearAll();
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      {/* Trigger + popover + "see all" modal render only when the bell
          owns its own UI (the header). In `headless` mode (dashboard
          pages, §20) the sidebar profile menu owns the unread badge +
          AllNotificationsModal; this component is mounted only to keep
          the store boot (setUser via /api/me) + the live toast stack
          alive. */}
      {!headless && (
      <>
      <button
        type="button"
        ref={bellRef}
        onClick={() => {
          // Compute `next` from current state and call both setOpen
          // and markAllRead at the top level — NOT inside the setOpen
          // updater. React invokes updater functions during render
          // (twice in StrictMode for idempotency checks), and the
          // synchronous `emit()` inside `markAllRead` fans out to
          // store listeners that call setState on subscribed
          // components — triggering React's "Cannot update a
          // component while rendering a different component" error.
          // Bug surfaced 2026-05-24 during PR #33 testing.
          //
          // "All-read on bell open" — product decision 2026-05-24.
          // Fires the moment the popover opens so the unread dot +
          // badge clear instantly. The store optimistically flips
          // every local row's `read` to true AND fires the
          // /api/notifications/read-all call in the background.
          // We don't gate on `items.length` — markAllRead no-ops
          // when there's nothing unread to flip.
          const next = !open;
          setOpen(next);
          if (next) notificationStore.markAllRead();
        }}
        aria-label={dict.dialogs.notifications.bellTitle}
        aria-expanded={open}
        // Sits in the TopUtilityBar next to search (user direction
        // 2026-06-11) - same h-9 icon-button vocabulary as its
        // neighbours (search / theme / language). `relative` is kept so
        // the unread badge can anchor to the corner.
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay-soft hover:text-foreground"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {unread > 0 ? (
          // Sky-blue info chip. Tailwind `bg-blue-500` (#3B82F6) —
          // brand `--tq-blue` is violet-leaning at badge size; same
          // rule as PreviewActionBar / SlideNavSidebar comment-count
          // chips (memory: feedback_badge_blue).
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-foreground shadow">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {bodyMounted && open && bellRect
        ? createPortal(
            // Static glass surface — no transform, no opacity animation
            // on this element. Any transform / opacity != 1 creates a
            // stacking context that traps backdrop-filter and kills the
            // blur (the very bug that made the header blur visible but
            // the popover not). Open / close animation moves inside via
            // an inner motion.div on the CONTENT, leaving the glass
            // surface itself static. Width is fixed to 320px so we can
            // centre via explicit left math (no `-translate-x-1/2`).
            <div
              dir={dir}
              data-bell-popover
              // `.in-slide-popover` (dark navy 45% alpha) instead of
            // `.surface-popover` (fully transparent + glass blur). The
            // bell can float over the slide canvas on /project/[id]
            // pages, and bright-theme slides (white backgrounds) were
            // showing through the transparent popover, leaving the
            // white notification text unreadable on both Safari and
            // Chrome. The MarkerPreviewPopup over slides solves the
            // same problem with `.in-slide-popover` — porting that
            // recipe here so the bell behaves identically. The
            // backdrop blur stays on; the dark tint just clamps the
            // composite luminance into a band where white text reads.
            className="in-slide-popover fixed z-[1100] w-80 overflow-hidden rounded-2xl"
              style={{
                top: bellRect.top,
                left: popoverLeft(bellRect.centerX, window.innerWidth),
              }}
            >
              <motion.div
                key="bell-content"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{dict.dialogs.notifications.bellTitle}</p>
              {unread > 0 ? (
                // Sky-blue info chip — see badge color note above.
                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium leading-none text-foreground">
                  {dict.dialogs.notifications.bellNew.replace("{count}", String(unread))}
                </span>
              ) : null}
            </div>

            <div className="max-h-[360px] overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <span className="material-symbols-outlined mb-2 block text-[40px] text-foreground/30">
                    inbox
                  </span>
                  <p className="text-xs text-foreground/50">{dict.dialogs.notifications.none}</p>
                </div>
              ) : (
                visible.map((n) => (
                  <NotificationRow key={n.id} n={n} onClick={handleItemClick} />
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-foreground/[0.08] px-3 py-3">
              <button
                type="button"
                onClick={handleClearAll}
                disabled={items.length === 0}
                className="btn-pill"
              >
                {dict.dialogs.notifications.clearAll}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSeeAllOpen(true);
                }}
                disabled={items.length === 0}
                className="btn-pill"
              >
                {dict.dialogs.notifications.seeAll}
              </button>
            </div>
              </motion.div>
            </div>,
            document.body,
          )
        : null}

      <AllNotificationsModal
        open={seeAllOpen}
        onClose={() => setSeeAllOpen(false)}
        items={items}
      />
      </>
      )}

      {/* Toast stack — portal'd to body so positioning isn't trapped by
          the header's stacking context. Anchored under the bell at the
          same x-centre + width as the popover. Hidden while the bell
          popover is open (toasts would be redundant there). */}
      {bodyMounted && !open && bellRect && toasts.length > 0
        ? createPortal(
            // Container is plain `relative` (not flex) — each toast is
            // positioned absolutely with its `y` driven by index, so the
            // animation is fully deterministic. Removes the
            // `layout` ↔ AnimatePresence reflow fight that was causing
            // the evicted toast to bounce between positions.
            <div
              dir={dir}
              className="pointer-events-none fixed z-[1099] w-80"
              style={{
                top: bellRect.top,
                left: popoverLeft(bellRect.centerX, window.innerWidth),
                // 3 visible slots + an extra slot's worth of headroom
                // for the evicted toast to fade out from. Slot height
                // matches BellToast (see TOAST_SLOT_HEIGHT below).
                height: TOAST_SLOT_HEIGHT * 4,
              }}
            >
              <AnimatePresence initial={true}>
                {toasts.map((n) => (
                  <BellToast
                    key={n.id}
                    n={n}
                    y={toastPositions.get(n.id) ?? 0}
                    onMeasureHeight={setToastHeight}
                    onClick={(notif) => {
                      handleItemClick(notif);
                      dismissToast(notif.id);
                    }}
                    onDismiss={() => dismissToast(n.id)}
                  />
                ))}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function BellToast({
  n,
  y,
  onMeasureHeight,
  onClick,
  onDismiss,
}: {
  n: Notification;
  // Cumulative `y` offset from the top of the toast container.
  // Computed by the parent from the heights of every toast above
  // this one — see `toastPositions` in BellDropdown. Drives both
  // the slide-in animation (initial below) AND the slide-down
  // shuffle when a new toast is prepended OR an upstream toast
  // expands and grows taller.
  y: number;
  // Reports this toast's measured rendered height to the parent so
  // the cumulative-y math accounts for expanded vs collapsed states.
  // Receives our id + a fresh pixel height each time ResizeObserver
  // fires (e.g. expand toggle, content reflow). Parent dedupes
  // identical values so we don't loop.
  onMeasureHeight: (id: string, h: number) => void;
  onClick: (n: Notification) => void;
  onDismiss: () => void;
}) {
  const dict = useDict();
  // ResizeObserver-driven height reporting. Falls back to a no-op on
  // environments without RO (older Safari pre-13.1, jsdom in tests);
  // the parent's TOAST_SLOT_HEIGHT default still positions toasts at
  // the legacy slot offsets in that branch.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === "undefined") return;
    const el = rootRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // `borderBoxSize` is the cross-browser-correct measurement (
      // matches the visible bounds including padding + border). Fall
      // back to contentRect.height where borderBoxSize isn't reported
      // (older Safari) — slight underestimate but tolerable.
      const borderBox = entry.borderBoxSize?.[0];
      const h = borderBox
        ? borderBox.blockSize
        : entry.contentRect.height;
      if (h > 0) onMeasureHeight(n.id, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.id, onMeasureHeight]);

  // Dynamic-y positioning. When a new toast is prepended OR an
  // upstream toast's height changes (expand toggle), `y` changes →
  // motion animates from old to new smoothly. On exit, motion
  // freezes the last `animate.y` value, so the evicted toast fades
  // out at its final post-shift position.
  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, y: y - 16 }}
      animate={{ opacity: 1, y }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      // Absolute positioning so each toast is anchored only by its
      // animated transform — no flex/layout interaction. Same glass
      // surface treatment as the bell popover.
      // Toast surface mirrors the dropdown — `.in-slide-popover`
      // (dark tint at 45% alpha) so a brightly themed slide showing
      // through doesn't wash the white notification text out. Same
      // recipe as the MarkerPreviewPopup on slides.
      className="in-slide-popover pointer-events-auto absolute inset-x-0 top-0 overflow-hidden rounded-2xl"
    >
      <NotificationRow n={n} onClick={onClick} compact={false} showTime={false} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label={dict.common.close}
        // `end-4` (16 px) + `h-6 w-6` (24 × 24) match the chevron in
        // NotificationRow's end column exactly — same end offset (the
        // row uses `px-4`, so its end column's right edge is also 16 px
        // from the row edge) and same button size, so both glyphs share
        // one vertical centerline. `end-3` + `h-7 w-7` made the close-X
        // sit 4 px further toward the visual edge AND 4 px wider, so
        // the chevron underneath looked offset toward the centre.
        // `top-3` stays unchanged — the chevron is below the close-X
        // via the spacer in NotificationRow, not a top-offset match.
        className="absolute end-4 top-3 flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </motion.div>
  );
}

// Single row used by the dropdown, toast (compact=false + showTime=false),
// and the modal (showDelete=true). Layout is RTL-friendly: icon on the
// start side, text in the middle, timestamp + expand chevron stacked
// on the end. Renders as a button when the notification carries an
// href so the row is keyboard-focusable.
//
// Expand: each row owns an `expanded` state that toggles full-text vs
// truncated. The chevron in the end column rotates 180° when open. We
// stop-propagation on the toggle so it doesn't also fire the row's
// onClick (which would navigate via href). Same toggle surface across
// toast / dropdown / modal so the gesture is one and the same.
export function NotificationRow({
  n,
  onClick,
  showDelete,
  compact = true,
  showTime = true,
}: {
  n: Notification;
  onClick?: (n: Notification) => void;
  showDelete?: boolean;
  compact?: boolean;
  showTime?: boolean;
}) {
  const dict = useDict();
  // Per-type icon (comment → speech bubble, invite → envelope, …),
  // monochrome on the bell — colour is reserved for the dashboard widget.
  const iconGlyph = notificationIcon(n);
  const clickable = !!n.href || !!onClick;
  const [expanded, setExpanded] = useState(false);
  // True between the toggle click and the `max-height` transition's
  // `transitionend` event. Used to KEEP the wrap-mode at `break-words`
  // during a collapse so the multi-line text stays multi-line while the
  // box shrinks. Without this guard, `truncate` (`white-space: nowrap`)
  // applies instantly the moment `expanded` flips to false — the text
  // snaps to a single line in frame 1 and only the empty box height
  // animates, so the collapse reads as "not animating" even though the
  // CSS transition is correctly running on max-height. Pairs with the
  // onTransitionEnd handler below.
  const [transitioning, setTransitioning] = useState(false);

  // Clip detection — hide the chevron entirely when collapsed content
  // fits in the 2-line clamp. With `line-clamp-2` an unclipped <p>
  // satisfies `scrollHeight === clientHeight`; a clipped one has
  // scrollHeight > clientHeight by however many overflow pixels there
  // are. A 1 px tolerance accounts for sub-pixel font-metric rounding
  // that can give a 0.5 px false positive on some font / DPI combos.
  // Measured per-element (title + desc) via ResizeObserver so the
  // result reacts to font load, viewport resize, and content updates
  // (e.g. grouping-merge bumps the title text on `notification.created`
  // re-broadcast). Bug fix 2026-05-24.
  const titleRef = useRef<HTMLParagraphElement | null>(null);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const [isClipped, setIsClipped] = useState(false);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Measurement only meaningful in the COLLAPSED state — when
      // expanded the box grows to fit and scrollHeight == clientHeight
      // trivially. Skip during transitioning too: max-height is
      // mid-animation and the comparison is noisy.
      if (expanded || transitioning) return;
      // "Clipped" = at least MOST of a line hidden, not a few pixels.
      // Chrome's standardized line-clamp reports scrollHeight ~3px
      // above clientHeight even for unclipped single-line content
      // (leading/descender rounding), so the old `+ 1` tolerance made
      // EVERY row grow a chevron (bug 2026-06-12). Compare against
      // 80% of the element's own line-height instead.
      const clipped = (el: HTMLParagraphElement | null) => {
        if (!el) return false;
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
        return el.scrollHeight - el.clientHeight >= lineHeight * 0.8;
      };
      setIsClipped(clipped(titleRef.current) || clipped(descRef.current));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (titleRef.current) ro.observe(titleRef.current);
    if (descRef.current) ro.observe(descRef.current);
    return () => ro.disconnect();
  }, [n.title, n.desc, expanded, transitioning]);

  // Show the chevron when EITHER content is clipped (so the user can
  // expand to see the rest) OR the row is currently expanded (so the
  // user can collapse back). Hide it when content fits unclipped in
  // the 2-line clamp — there's nothing to expand and the spacer would
  // otherwise leave a meaningless icon in the corner.
  const showChevron = isClipped || expanded;

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      notificationStore.remove(n.id);
    },
    [n.id],
  );

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setTransitioning(true);
    setExpanded((v) => !v);
  }, []);

  // Resets the wrap-mode guard once the max-height animation lands.
  // Filter on propertyName so unrelated property transitions on the
  // <p> (e.g. opacity from a parent fade) don't drop the guard early.
  const handleMaxHeightEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName === "max-height") {
      setTransitioning(false);
    }
  }, []);

  // Outer is a <div> (not <button>) so the inner delete <button> isn't
  // a nested-button hydration error. Keyboard a11y comes via
  // role="button" + tabIndex=0 + Enter/Space handler when the row is
  // clickable.
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!clickable) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick?.(n);
      }
    },
    [clickable, onClick, n],
  );

  // Read items mute their content (~50 % opacity) so the eye is drawn
  // to unread items first. Icon stays white for all rows (no kind-tinted
  // colours per the brand rule — kind comes through the glyph only).
  //
  // Animation: pure CSS — same vocabulary as the sidebar collapse
  // (`transition-all duration-300 ease-in-out`). The title + desc
  // each wrap in a `max-h` container that grows from one line-height
  // to a generous 200 px when the row toggles open. Framer's
  // `layout` was producing a `scaleY` transform that distorted the
  // text mid-animation — CSS max-height keeps the glyphs crisp.
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onClick?.(n) : undefined}
      onKeyDown={clickable ? handleRowKeyDown : undefined}
      className={`group relative flex w-full items-start gap-3 px-4 ${compact ? "py-3.5" : "py-4"} text-start transition-colors hover:bg-foreground/[0.04] ${
        clickable ? "cursor-pointer" : "cursor-default"
      } ${n.read ? "opacity-50" : ""} focus-visible:bg-foreground/[0.06] focus-visible:outline-none`}
    >
      {/* Circular icon chip - the /lab/billing showcase design adopted
          as the bell-wide row style (user direction 2026-06-11). The
          glyph itself still comes from the per-type role mapping
          (lib/notifications/visuals). */}
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] text-foreground/80">
        <span className="material-symbols-outlined text-[16px]">{iconGlyph}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!n.read ? (
            // Sky-blue unread dot — see badge color note above.
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500"
              aria-hidden
            />
          ) : null}
          {/* Title is `line-clamp-2` collapsed — short titles render on
              one line naturally, two-line titles render in full, only
              3+ line titles get the chevron clipped at 2 lines with
              ellipsis. Previously `truncate` (1 line + ellipsis) cut
              perfectly normal notification titles like "Osama علّقت على
              شريحة في <project>" mid-word, forcing the user to expand
              just to read a 2-line message. Bumped 2026-05-24. */}
          <p
            ref={titleRef}
            className={`overflow-hidden text-[13px] font-medium leading-snug text-foreground transition-[max-height] duration-300 ease-in-out ${
              expanded || transitioning ? "break-words" : "line-clamp-2"
            }`}
            style={{ maxHeight: expanded ? 200 : 40 }}
            onTransitionEnd={handleMaxHeightEnd}
          >
            {n.title}
          </p>
        </div>
        {n.desc ? (
          // Desc mirrors the title's 2-line collapsed clamp for the
          // same reason — short descriptions read in full without
          // needing the chevron, only long ones truncate.
          <p
            ref={descRef}
            className={`mt-1 overflow-hidden text-[11px] leading-relaxed text-foreground/55 transition-[max-height] duration-300 ease-in-out ${
              expanded || transitioning
                ? "break-words"
                : `line-clamp-2 ${compact ? "max-w-[220px]" : ""}`
            }`}
            style={{ maxHeight: expanded ? 200 : 40 }}
            onTransitionEnd={handleMaxHeightEnd}
          >
            {n.desc}
          </p>
        ) : null}
      </div>
      {/* End column — time on top, chevron toggle below, delete (if
          enabled) below that. Flex-col so the chevron always sits
          under the time when both are shown.
          When `showTime=false` (toast mode), an INVISIBLE spacer
          replaces the time slot so the chevron lands BELOW the
          parent toast's absolute close-X (which sits at top-3 end-3,
          h-7 = 28 px). Without the spacer the chevron stacks on top
          of the close-X — both icons occupy the same ~24 × 24 corner
          square. With the spacer, chevron starts at y = py-4 (16) +
          spacer (28) = 44 px, well clear of the close-X's 12–40 px
          vertical band. */}
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        {showTime ? (
          <span className="text-[10px] text-foreground/40" dir="ltr">
            {formatNotificationTime(n.createdAt)}
          </span>
        ) : (
          // Toast mode spacer — reserves the top-right corner for the
          // toast's absolute close-X (h-7 w-7 at top-3 end-4). KEEP this
          // even when the chevron is hidden, otherwise the title text
          // flows under the close-X and looks visually broken. Without
          // a chevron beneath, the spacer is the only thing carving
          // safe space around the X.
          <span className="h-7 w-7" aria-hidden />
        )}
        {showChevron ? (
          <button
            type="button"
            onClick={handleToggleExpand}
            aria-label={expanded ? dict.dialogs.notifications.collapse : dict.dialogs.notifications.showFull}
            aria-expanded={expanded}
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <span
              className={`material-symbols-outlined text-[16px] transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            >
              expand_more
            </span>
          </button>
        ) : null}
        {showDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            aria-label={dict.dialogs.notifications.delete}
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
