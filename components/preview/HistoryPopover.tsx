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
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc — matches the bell dropdown
  // affordances. Outside click is gated to the surface AND the
  // trigger button (so clicking the trigger again toggles via
  // the parent rather than instantly reopening).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current?.contains(target)) return;
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
  if (!open || !triggerRect) return null;

  // Right-anchored: the popover's right edge lines up with the
  // History button's right edge (the visual-right corner under
  // the icon in RTL). Drops down-and-left from the trigger
  // rather than centred — feels less "menu-bar" and more like a
  // chip flag tied to the button.
  const left = Math.max(
    VIEWPORT_EDGE_INSET_PX,
    Math.min(
      triggerRect.right - POPOVER_WIDTH,
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_EDGE_INSET_PX,
    ),
  );
  const top = triggerRect.bottom + ANCHOR_GAP_PX;

  return createPortal(
    <div
      ref={surfaceRef}
      dir="rtl"
      data-history-popover
      className="glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] fixed z-[1100] overflow-hidden rounded-2xl shadow-2xl"
      style={{ top, left, width: POPOVER_WIDTH }}
    >
      <motion.div
        key="history-content"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="border-b border-white/[0.08] px-3 py-2">
          <p className="text-xs font-semibold text-white">سجل الإصدارات</p>
        </header>
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {versions.map((row) => (
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
    </div>,
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
