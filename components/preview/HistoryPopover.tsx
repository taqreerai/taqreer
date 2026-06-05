"use client";

// History popover anchored under the slide pill's "السجل" button.
// Lists up to MAX_VERSIONS_PER_SLIDE history rows newest-first.
// Click a row → restores that version (non-destructive pointer move).
//
// Anchoring matches the BellDropdown pattern:
// - Renders via `createPortal` to escape the canvas's overflow-
//   hidden + z-index stacking context.
// - Position computed from the trigger button's `DOMRect`: fixed
//   `top = bottom + 8`, `left = centerX - width/2`, clamped to
//   the viewport so the popover never spills out at narrow widths.
// - `.glass-popover` + Tailwind `backdrop-blur-glass` for the
//   surface (Pattern 3 — Layout surfaces).
// - Inner content fades in via a motion.div so the outer surface
//   stays static and keeps its backdrop-filter intact (any
//   transform / opacity != 1 on the surface creates a stacking
//   context that traps backdrop-filter — same caveat as Bell).
//
// Closes when the user picks a row, clicks outside, or hits Esc.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

export type HistoryRow = {
  versionNumber: number;
  source: string; // "create" | "regen" | "partial_regen" | "restore"
  createdAt: string; // ISO
};

const POPOVER_WIDTH = 220;
// Margin from the trigger button. Matches the per-button tooltip
// `mt-3` (12 px) on the pill so the two affordances feel like
// they belong to the same visual family.
const ANCHOR_GAP_PX = 12;
const VIEWPORT_EDGE_INSET_PX = 12;

export function HistoryPopover({
  open,
  triggerRect,
  versions,
  currentVersionNumber,
  busy,
  onRestore,
  onClose,
  onExitComplete,
}: {
  open: boolean;
  // null while the popover is closed or the trigger hasn't mounted
  // yet. The parent owns this so the popover position re-anchors
  // any time the trigger moves (focus shift between slides).
  triggerRect: DOMRect | null;
  versions: HistoryRow[];
  currentVersionNumber: number | null;
  // True while a restore round-trip is in flight — disables every
  // row so the user can't fire concurrent restores.
  busy: boolean;
  onRestore: (versionNumber: number) => void;
  onClose: () => void;
  // Fires after the exit animation finishes. Used by the parent
  // to release the slide pill's "stay visible" latch — the pill
  // would otherwise flicker the instant `open` flipped to false
  // because the cursor was still over the fading popover.
  onExitComplete?: () => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc — matches the bell dropdown
  // affordances. Outside click is gated to the surface AND the
  // trigger button (any element with `data-history-trigger`): the
  // trigger owns its own toggle handler in the parent (DeckView's
  // onOpenHistory). If we close here on mousedown, the following
  // `click` hits the trigger which re-opens the popover — the user
  // sees "click = always open" instead of toggle. The earlier
  // comment claimed the exclusion existed but the code didn't
  // actually do it (user-flagged 2026-05-20).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      if (target.closest?.("[data-history-trigger]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  // Right-anchored: the popover's right edge lines up with the
  // History button's right edge (the visual-right corner under
  // the icon in RTL). Drops down-and-left from the trigger
  // rather than centred — feels less "menu-bar" and more like a
  // chip flag tied to the button.
  // Coordinates are 0/0 when triggerRect is null (initial mount)
  // — the conditional render below keeps the surface unmounted in
  // that case, so the zero coords never paint.
  const left = triggerRect
    ? Math.max(
        VIEWPORT_EDGE_INSET_PX,
        Math.min(
          triggerRect.right - POPOVER_WIDTH,
          window.innerWidth - POPOVER_WIDTH - VIEWPORT_EDGE_INSET_PX,
        ),
      )
    : 0;
  const top = triggerRect ? triggerRect.bottom + ANCHOR_GAP_PX : 0;

  return createPortal(
    // AnimatePresence wraps the conditional so the popover
    // animates OUT smoothly when `open` flips to false (e.g.
    // after a restore commits and the parent clears
    // historyAnchor). Without this, the popover unmounted
    // instantly — visible glitch the user flagged 2026-05-20.
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && triggerRect ? (
        <motion.div
          key="history-popover"
          ref={surfaceRef}
          dir="rtl"
          data-history-popover
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed z-[1100] overflow-hidden rounded-2xl shadow-2xl"
          style={{ top, left, width: POPOVER_WIDTH }}
        >
          <header className="border-b border-white/[0.08] px-3 py-2">
            <p className="text-xs font-semibold text-white">سجل الإصدارات</p>
          </header>
          <ul className="flex max-h-[280px] flex-col overflow-y-auto overscroll-contain">
            <AnimatePresence initial={false}>
              {versions.slice(0, 20).map((row) => (
                <motion.li
                  key={row.versionNumber}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <HistoryItem
                    row={row}
                    isCurrent={row.versionNumber === currentVersionNumber}
                    disabled={busy}
                    onClick={() => onRestore(row.versionNumber)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
            {versions.length === 0 ? (
              <li className="px-4 py-3 text-xs text-white/50">
                لا توجد إصدارات سابقة.
              </li>
            ) : null}
          </ul>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function HistoryItem({
  row,
  isCurrent,
  disabled,
  onClick,
}: {
  row: HistoryRow;
  isCurrent: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const number = row.versionNumber.toString().padStart(2, "0");
  const relative = formatDistanceToNow(new Date(row.createdAt), {
    addSuffix: true,
    locale: ar,
  });
  return (
    <button
      type="button"
      onClick={disabled || isCurrent ? undefined : onClick}
      disabled={disabled || isCurrent}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start transition-colors ${
        isCurrent
          ? "bg-white/[0.06] text-white"
          : "text-white/80 hover:bg-white/[0.04] hover:text-white"
      } ${disabled && !isCurrent ? "cursor-wait opacity-60" : ""}`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-white">
          {`الإصدار ${number}`}
        </span>
        <span className="text-[10px] text-white/50">{relative}</span>
      </span>
      {isCurrent ? (
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-white"
          style={{ background: "var(--tq-violet)" }}
        >
          الحالي
        </span>
      ) : null}
    </button>
  );
}
