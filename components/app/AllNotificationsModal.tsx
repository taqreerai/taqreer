"use client";

// Full notifications list, modal style. Triggered from the bell dropdown's
// "عرض الكل" button. Mirrors the slide lightbox visual treatment:
// glass-modal backdrop, glass-card panel, body-scroll lock + Esc to close.
// Scrollable; up to 30 items (the store's cap).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationRow } from "@/components/app/BellDropdown";
import {
  notificationStore,
  type Notification,
} from "@/lib/notifications/store";

export function AllNotificationsModal({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: Notification[];
}) {
  const router = useRouter();
  // The bell already calls setUser → store is hydrated. This modal just
  // reads the same snapshot via the `items` prop.

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleItemClick = useCallback(
    (n: Notification) => {
      notificationStore.markRead(n.id);
      if (n.href) {
        onClose();
        router.push(n.href);
      }
    },
    [router, onClose],
  );

  // Clear-all phase state machine:
  //   idle       — default
  //   clearing   — bottom-up stagger removing items, one every 80 ms
  //   collapsing — all items gone; panel runs the scale-down + fade
  //                animation (`.panel-closing`), then onClose fires
  type ClearPhase = "idle" | "clearing" | "collapsing";
  const [clearPhase, setClearPhase] = useState<ClearPhase>("idle");
  // Track every setTimeout the clear-all sequence schedules so we can
  // cancel them if the modal closes mid-sequence (Esc / backdrop) —
  // otherwise the queued timers keep firing and trigger stale
  // notificationStore.remove / setClearPhase / onClose calls against
  // a modal that's already closed.
  const clearTimersRef = useRef<number[]>([]);
  const cancelClearTimers = useCallback(() => {
    for (const id of clearTimersRef.current) window.clearTimeout(id);
    clearTimersRef.current = [];
  }, []);

  const handleClearAll = useCallback(() => {
    if (clearPhase !== "idle") return;
    if (items.length === 0) return;
    cancelClearTimers();
    setClearPhase("clearing");
    const STAGGER_MS = 80;
    const idsBottomUp = items.map((n) => n.id).reverse();
    idsBottomUp.forEach((id, idx) => {
      clearTimersRef.current.push(
        window.setTimeout(() => notificationStore.remove(id), idx * STAGGER_MS),
      );
    });
    // After all items are removed (+ a small grace for the last row's
    // exit anim to finish), trigger the panel's collapse animation,
    // then close.
    const totalStaggerMs = idsBottomUp.length * STAGGER_MS;
    clearTimersRef.current.push(
      window.setTimeout(() => setClearPhase("collapsing"), totalStaggerMs + 200),
    );
    clearTimersRef.current.push(
      window.setTimeout(() => {
        onClose();
        setClearPhase("idle");
      }, totalStaggerMs + 200 + 320),
    );
  }, [clearPhase, items, onClose, cancelClearTimers]);

  // Reset the phase + cancel any in-flight timers if the modal is
  // closed externally during a sequence (Esc / backdrop click) so a
  // re-open starts clean and no stale callbacks fire. setState-in-
  // effect is intentional — closure of an external prop (`open`)
  // drives an internal-only state reset.
  useEffect(() => {
    if (!open) {
      cancelClearTimers();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClearPhase("idle");
    }
  }, [open, cancelClearTimers]);
  // Unmount safety: clear timers even when the host stops rendering us.
  useEffect(() => cancelClearTimers, [cancelClearTimers]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          {/* Dark overlay — sibling, animated. Dims the whole page like
              the old `.glass-modal` did. NO backdrop-filter so the panel
              (also a sibling, fixed-positioned) can see the page below
              it via its own backdrop-filter. */}
          <motion.div
            key="dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            // Same dim level as `.glass-modal` (`--tq-surface-modal`,
            // 88 % dark) so the see-all modal feels consistent with the
            // comment lightbox / slide lightbox.
            style={{ background: "var(--tq-surface-modal)" }}
            className="fixed inset-0 z-[1000]"
          />
          {/* Static glass panel — fixed-positioned, NOT inside any
              animated ancestor with transform / opacity. That's the
              only way backdrop-filter actually blurs the page through
              the panel (any transform / opacity != 1 ancestor traps it
              in a stacking context). Centering via a flex-centered
              wrapper (pointer-events: none so clicks fall through to
              the dim overlay); the panel itself has NO transform. */}
          <div
            key="panel-wrapper"
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="جميع الإشعارات"
            onClick={(e) => e.stopPropagation()}
            className={`glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto flex w-[min(100vw-24px,560px)] max-h-[min(85vh,720px)] flex-col overflow-hidden rounded-2xl ${
              clearPhase === "collapsing" ? "panel-closing" : ""
            }`}
          >
            <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">جميع الإشعارات</h2>
                <p className="text-xs text-white/50">
                  {items.length === 0
                    ? "لا توجد إشعارات"
                    : `${items.length} إشعار`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto py-1">
              {items.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <span className="material-symbols-outlined mb-3 block text-[48px] text-white/30">
                    inbox
                  </span>
                  <p className="text-sm text-white/50">لا توجد إشعارات لعرضها</p>
                </div>
              ) : (
                // AnimatePresence + layout per row: deleting any item
                // triggers an exit animation (slide right + fade) and
                // the rows below smoothly slide up to fill the gap via
                // framer-motion's layout transition.
                <AnimatePresence mode="popLayout" initial={false}>
                  {items.map((n) => (
                    <motion.div
                      key={n.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -24 }}
                      transition={{
                        opacity: { duration: 0.18 },
                        x: { duration: 0.18 },
                        layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                      }}
                    >
                      <NotificationRow
                        n={n}
                        onClick={handleItemClick}
                        showDelete
                        compact={false}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {items.length > 0 ? (
              <footer className="flex items-center justify-end border-t border-white/[0.08] px-4 py-3">
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={clearPhase !== "idle"}
                  className="btn-pill"
                >
                  مسح الكل
                </button>
              </footer>
            ) : null}
          </div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
