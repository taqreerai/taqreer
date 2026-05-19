"use client";

// Per-slide floating control pill. Sits above the hero slide with a
// 30 px top margin, fades in on canvas hover, fades out when the
// mouse leaves the canvas. Owns the per-slide actions that operate
// on the currently-focused slide:
//
//   ← Undo       Revert this slide to its previous SlideVersion
//   ⟳ Try again  Replay cached comments through partial regen
//   ↻ Regen      Clean partial regen (no comments)
//   ⌛ History   Open the version list popover
//   🔒 Lock      Lock this slide against full-deck regen
//
// Visibility rules at the per-slide level (per the product req):
//   - Lock + Regen are ALWAYS visible
//   - Undo + Try again appear only when meaningful
//   - When the slide has no draft beyond v1, Undo + Try again are
//     rendered but disabled (greyed out, not hidden — keeps the
//     pill's geometry stable across slides)
//
// This file ships the VISUAL pill only — buttons are wired up in
// later steps (Lock = step 4, Undo/History = step 5, Regen/Try
// again = step 6). Until then click handlers are no-ops, matching
// the user's "go step by step, we test as we go" cadence.

import { useState } from "react";

export type SlidePillState = {
  // Slide's current version number — controls Undo affordance.
  // 1 = no history beyond initial; >1 = Undo enabled.
  currentVersionNumber: number;
  // Whether this slide has a cached comment payload — controls
  // "Try again" affordance.
  hasCachedComments: boolean;
  // Lock state — flips the Lock button's label + active styling.
  isLocked: boolean;
};

export type SlidePillProps = SlidePillState & {
  onUndo?: () => void;
  onTryAgain?: () => void;
  onRegen?: () => void;
  onOpenHistory?: () => void;
  onToggleLock?: () => void;
};

// Glass-pill chrome matches `.btn-pill` recipe from globals.css
// (Pattern 1: normal-button surface). Icon-only square buttons —
// a labeled pill would overflow the slide in 9:16 (native 1080
// wide, scales to ~400 px in the preview hero). Tooltip /
// screen-reader text lives in `aria-label`.
const PILL_BTN_CLASS =
  "backdrop-blur-glass inline-flex h-9 w-9 items-center justify-center rounded-full border text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const PILL_BTN_STYLE = {
  background: "rgba(255, 255, 255, var(--glass-opacity))",
  borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
} as const;

export function SlidePill({
  currentVersionNumber,
  hasCachedComments,
  isLocked,
  onUndo,
  onTryAgain,
  onRegen,
  onOpenHistory,
  onToggleLock,
}: SlidePillProps) {
  // Local guard so a brief mouse-shake near the canvas edge doesn't
  // toggle the pill in/out repeatedly. The hover-driven visibility
  // is owned by the parent (CSS group-hover); this state is only
  // for child interactions (e.g. the History popover stays open
  // until dismissed even if the cursor briefly leaves the pill).
  const [historyOpen, setHistoryOpen] = useState(false);

  // Per the product spec: when no draft exists (slide is still at
  // v1), only Lock + Regen are active. Undo / Try again / History
  // grey out — the controls are visible (stable pill geometry)
  // but communicate "nothing to act on yet."
  const canUndo = currentVersionNumber > 1 && !isLocked;
  const canTryAgain = hasCachedComments && !isLocked;
  const canRegen = !isLocked;
  const canOpenHistory = currentVersionNumber > 1;

  return (
    <div
      // top: 30px overlay above the slide; centered horizontally;
      // pointer-events:auto so child clicks land (parent canvas may
      // have crosshair cursor during comment mode — we don't want
      // the pill to take that styling).
      className="pointer-events-auto absolute left-1/2 z-20 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style={{ top: 30 }}
      // Reset history popover when the pill itself unmounts on
      // canvas leave — we don't want a stale-open menu reappearing
      // next time the user hovers in.
      onMouseLeave={() => setHistoryOpen(false)}
    >
      <div
        className="flex items-center gap-1 rounded-full border p-1"
        style={{
          background: "rgba(3, 3, 13, 0.6)",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
          WebkitBackdropFilter:
            "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
        }}
      >
        <PillButton
          icon="undo"
          label="تراجع"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <PillButton
          icon="replay"
          label="حاول مرة أخرى"
          disabled={!canTryAgain}
          onClick={onTryAgain}
        />
        <PillButton
          icon="autorenew"
          label="إعادة إنشاء"
          disabled={!canRegen}
          onClick={onRegen}
        />
        <PillButton
          icon="history"
          label="السجل"
          disabled={!canOpenHistory}
          onClick={() => {
            setHistoryOpen((v) => !v);
            onOpenHistory?.();
          }}
        />
        <PillButton
          icon={isLocked ? "lock" : "lock_open"}
          label={isLocked ? "مقفل" : "قفل"}
          active={isLocked}
          onClick={onToggleLock}
        />
      </div>
    </div>
  );
}

function PillButton({
  icon,
  label,
  disabled,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${PILL_BTN_CLASS} ${
        active
          ? "border-white/60 text-white"
          : "hover:bg-white/10"
      }`}
      style={
        active
          ? {
              ...PILL_BTN_STYLE,
              borderColor: "rgba(255, 255, 255, 0.6)",
            }
          : PILL_BTN_STYLE
      }
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      {/* Visually hidden — kept for screen readers in addition to
          the aria-label, since some readers prefer text content. */}
      <span className="sr-only">{label}</span>
    </button>
  );
}
