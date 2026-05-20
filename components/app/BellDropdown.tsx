"use client";

// Header bell + notification popover.
//
// Visual language: glass-card popover (matches `.glass-modal` blur) anchored
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

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import {
  formatNotificationTime,
  notificationStore,
  useNotifications,
  type Notification,
  type NotificationKind,
} from "@/lib/notifications/store";
import { AllNotificationsModal } from "@/components/app/AllNotificationsModal";

// Icon glyph + tint per notification kind. No square background — the
// icon stands alone in the row.
const KIND_VISUAL: Record<NotificationKind, { icon: string; color: string }> = {
  error:   { icon: "error",        color: "rgb(254, 202, 202)" },
  warning: { icon: "warning",      color: "rgb(255, 213, 175)" },
  info:    { icon: "info",         color: "rgb(189, 178, 255)" },
  success: { icon: "check_circle", color: "rgb(167, 243, 208)" },
  promo:   { icon: "campaign",     color: "rgb(248, 187, 220)" },
};

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

// Width (px) of the bell popover + every stacked toast. Used in
// both the inline style and the on-resize positioning math.
const POPOVER_WIDTH_PX = 320;

export function BellDropdown() {
  const router = useRouter();
  const items = useNotifications();
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
  const seenIdsRef = useRef<Set<string>>(new Set());
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

  // Re-measure the bell's screen position when the popover opens, when
  // toasts appear (so they can position correctly without requiring the
  // user to open the bell first), AND whenever the viewport
  // resizes/scrolls while either is visible.
  useEffect(() => {
    const needsRect = open || toasts.length > 0;
    if (!needsRect) return;
    const measure = () => {
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
  }, [open, toasts.length]);

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
        title: `اختبار التنبيه #${counter}`,
        desc: "هذا تنبيه تجريبي للتأكد من ظهور التوست تحت الجرس",
      });
    };
    return () => {
      delete w.__pushTestNotif;
    };
  }, []);

  // Wire the store to the current Supabase user once on mount. Without
  // this the store has no userId → push() drops silently and nothing
  // appears in the dropdown. Note: we don't react to auth changes here
  // because the dashboard layout already remounts on sign-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        notificationStore.setUser(data.user?.id ?? null);
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
  // glass-popover toast. Auto-dismisses after 15 s; user can close
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
      if (seenIdsRef.current.has(n.id)) continue;
      seenIdsRef.current.add(n.id);
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
    const combined = [...queued, ...toasts];
    const toEvict = combined.length > 3 ? combined.slice(3) : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        router.push(n.href);
      }
    },
    [router],
  );

  const handleClearAll = useCallback(() => {
    notificationStore.clearAll();
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        ref={bellRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="الإشعارات"
        aria-expanded={open}
        // Glass icon button — bg via preset-linked alpha, blur via
        // the Tailwind `backdrop-blur-glass` utility (memory:
        // feedback_tw_glass_system — raw `backdrop-filter:` loses
        // to Tailwind's compositional rule).
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
        }}
        className="backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-white/60 transition-colors hover:border-white/40 hover:text-white"
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unread > 0 ? (
          // Sky-blue info chip. Tailwind `bg-blue-500` (#3B82F6) —
          // brand `--tq-blue` is violet-leaning at badge size; same
          // rule as PreviewActionBar / SlideNavSidebar comment-count
          // chips (memory: feedback_badge_blue).
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
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
              dir="rtl"
              data-bell-popover
              className="glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] fixed z-[1100] w-80 overflow-hidden rounded-2xl shadow-2xl"
              style={{
                top: bellRect.top,
                left: Math.max(
                  12,
                  Math.min(bellRect.centerX - 160, window.innerWidth - 320 - 12),
                ),
              }}
            >
              <motion.div
                key="bell-content"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold text-white">الإشعارات</p>
              {unread > 0 ? (
                // Sky-blue info chip — see badge color note above.
                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                  {unread} جديد
                </span>
              ) : null}
            </div>

            <div className="max-h-[360px] overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <span className="material-symbols-outlined mb-2 block text-[40px] text-white/30">
                    inbox
                  </span>
                  <p className="text-xs text-white/50">لا توجد إشعارات</p>
                </div>
              ) : (
                visible.map((n) => (
                  <NotificationRow key={n.id} n={n} onClick={handleItemClick} />
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-3 py-3">
              <button
                type="button"
                onClick={handleClearAll}
                disabled={items.length === 0}
                className="btn-pill"
              >
                مسح الكل
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
                عرض الكل
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
              dir="rtl"
              className="pointer-events-none fixed z-[1099] w-80"
              style={{
                top: bellRect.top,
                left: Math.max(
                  12,
                  Math.min(
                    bellRect.centerX - 160,
                    window.innerWidth - 320 - 12,
                  ),
                ),
                // 3 visible slots + an extra slot's worth of headroom
                // for the evicted toast to fade out from. Slot height
                // matches BellToast (see TOAST_SLOT_HEIGHT below).
                height: TOAST_SLOT_HEIGHT * 4,
              }}
            >
              <AnimatePresence initial={true}>
                {toasts.map((n, i) => (
                  <BellToast
                    key={n.id}
                    n={n}
                    index={i}
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
  index,
  onClick,
  onDismiss,
}: {
  n: Notification;
  index: number;
  onClick: (n: Notification) => void;
  onDismiss: () => void;
}) {
  // Index-driven absolute positioning. Each slot is at `index *
  // TOAST_SLOT_HEIGHT` from the top of the container. When a new toast
  // is prepended, existing toasts re-render with index+1 → motion
  // animates `y` from old value to new (smooth slide down). On exit,
  // motion freezes the last `animate.y` value, so the evicted toast
  // fades out at its final (post-shift) position — exactly the
  // "slide down + fade out" the user described.
  return (
    <motion.div
      initial={{ opacity: 0, y: index * TOAST_SLOT_HEIGHT - 16 }}
      animate={{ opacity: 1, y: index * TOAST_SLOT_HEIGHT }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      // Absolute positioning so each toast is anchored only by its
      // animated transform — no flex/layout interaction. Same glass
      // surface treatment as the bell popover.
      className="glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] pointer-events-auto absolute inset-x-0 top-0 overflow-hidden rounded-2xl shadow-2xl"
    >
      <NotificationRow n={n} onClick={onClick} compact={false} showTime={false} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="إغلاق"
        className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
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
  const visual = KIND_VISUAL[n.kind];
  const clickable = !!n.href || !!onClick;
  const [expanded, setExpanded] = useState(false);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      notificationStore.remove(n.id);
    },
    [n.id],
  );

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
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
      className={`group relative flex w-full items-start gap-3 px-4 ${compact ? "py-3.5" : "py-4"} text-start transition-colors hover:bg-white/[0.04] ${
        clickable ? "cursor-pointer" : "cursor-default"
      } ${n.read ? "opacity-50" : ""} focus-visible:bg-white/[0.06] focus-visible:outline-none`}
    >
      <span className="material-symbols-outlined flex-shrink-0 text-[22px] text-white">
        {visual.icon}
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
          <p
            className={`overflow-hidden text-[13px] font-medium leading-snug text-white transition-[max-height] duration-300 ease-in-out ${
              expanded ? "break-words" : "truncate"
            }`}
            style={{ maxHeight: expanded ? 200 : 20 }}
          >
            {n.title}
          </p>
        </div>
        {n.desc ? (
          <p
            className={`mt-1 overflow-hidden text-[11px] leading-relaxed text-white/55 transition-[max-height] duration-300 ease-in-out ${
              expanded
                ? "break-words"
                : `truncate ${compact ? "max-w-[220px]" : ""}`
            }`}
            style={{ maxHeight: expanded ? 200 : 18 }}
          >
            {n.desc}
          </p>
        ) : null}
      </div>
      {/* End column — time on top, chevron toggle below, delete (if
          enabled) below that. Flex-col so the chevron always sits
          under the time when both are shown; for the toast (no time)
          the chevron sits flush with the close × in the parent. */}
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        {showTime ? (
          <span className="text-[10px] text-white/40" dir="ltr">
            {formatNotificationTime(n.createdAt)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleToggleExpand}
          aria-label={expanded ? "طي" : "عرض النص الكامل"}
          aria-expanded={expanded}
          className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span
            className={`material-symbols-outlined text-[16px] transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </button>
        {showDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            aria-label="حذف"
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 opacity-0 transition-all hover:bg-white/10 hover:text-white group-hover:opacity-100"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
