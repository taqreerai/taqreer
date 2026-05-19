"use client";

// Per-slide floating control pill. Sits above the hero slide with a
// 30 px top margin, fades in on canvas hover, fades out when the
// mouse leaves the canvas. Owns the per-slide actions that operate
// on the currently-focused slide:
//
//   ← Undo       Revert this slide to its previous SlideVersion
//   ⟳ Try again  Replay cached comments through partial regen  [AI]
//   ↻ Regen      Clean partial regen (no comments)              [AI]
//   ⌛ History   Open the version list popover
//   🔒 Lock      Lock this slide against full-deck regen        [CTA when active]
//
// STYLING (matches globals.css design vocabulary):
//   - Try again + Regen use `.btn-gradient-anim` (Pattern 4 — AI
//     trigger). The animated mesh-gradient stroke is the brand cue
//     for "Claude does work here", same as the regen toolbar button.
//   - Lock when active uses `.btn-gradient` (Pattern 2 — CTA, brand
//     gradient fill + shadow). When unlocked it's neutral glass.
//   - Undo + History stay neutral glass (Pattern 1 — normal button).
//   - Geometry is icon-only square (h-9 w-9) so the bar fits inside
//     both 16:9 and 9:16 slide canvases without overflowing.
//
// Visibility rules:
//   - Lock + Regen are ALWAYS visible
//   - Undo + Try again appear only when meaningful
//   - When the slide has no draft beyond v1, Undo / Try again /
//     History stay rendered but disabled (stable pill geometry)
//
// This file ships the VISUAL pill — click handlers are wired up in
// later steps (Lock = step 4, Undo/History = step 5, Regen/Try
// again = step 6).

import { useState } from "react";

export type SlidePillState = {
  currentVersionNumber: number;
  hasCachedComments: boolean;
  isLocked: boolean;
  // Disables every button (including Lock + Regen) while a regen
  // is mid-flight for this slide. Avoids double-clicks while the
  // hero overlay is up.
  busy?: boolean;
};

export type SlidePillProps = SlidePillState & {
  onUndo?: () => void;
  onTryAgain?: () => void;
  onRegen?: () => void;
  onOpenHistory?: () => void;
  onToggleLock?: () => void;
};

// Common geometry for every button on the pill. Icon-only square,
// hover/disabled handled by Tailwind utilities. The actual
// background / border / glow surface comes from the per-variant
// class (`btn-gradient-anim`, `btn-gradient`, or the neutral glass
// recipe below). Centralised so the five buttons stay pixel-
// identical regardless of variant.
const BUTTON_BASE =
  "relative inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition-all disabled:cursor-not-allowed disabled:opacity-40";

// Neutral glass surface (Pattern 1). Used by Undo, History, and
// the unlocked Lock button. Inline-style for the bg + border-color
// so they pick up the user's preset glass tokens at runtime.
const NEUTRAL_GLASS_STYLE = {
  background: "rgba(255, 255, 255, var(--glass-opacity))",
  borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
  backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
  WebkitBackdropFilter:
    "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
} as const;

type PillButtonVariant = "glass" | "ai" | "cta";

export function SlidePill({
  currentVersionNumber,
  hasCachedComments,
  isLocked,
  busy = false,
  onUndo,
  onTryAgain,
  onRegen,
  onOpenHistory,
  onToggleLock,
}: SlidePillProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  // Per the product spec: when no draft exists (slide is still at
  // v1), only Lock + Regen are active. Undo / Try again / History
  // grey out — the controls are visible (stable pill geometry)
  // but communicate "nothing to act on yet."
  const canUndo = currentVersionNumber > 1 && !isLocked && !busy;
  const canTryAgain = hasCachedComments && !isLocked && !busy;
  const canRegen = !isLocked && !busy;
  const canOpenHistory = currentVersionNumber > 1 && !busy;
  const canLock = !busy;

  return (
    <div
      // top: 30px overlay above the slide; centered horizontally;
      // pointer-events:auto so child clicks land (parent canvas may
      // have crosshair cursor during comment mode — we don't want
      // the pill to take that styling).
      className="pointer-events-auto absolute left-1/2 z-20 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style={{ top: 30 }}
      onMouseLeave={() => setHistoryOpen(false)}
    >
      <div
        className="flex items-center gap-1 rounded-full border p-1"
        style={{
          background: "rgba(3, 3, 13, 0.6)",
          borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          backdropFilter:
            "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
          WebkitBackdropFilter:
            "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
        }}
      >
        <PillButton
          icon="undo"
          label="تراجع"
          variant="glass"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <PillButton
          icon="replay"
          label="حاول مرة أخرى"
          variant="ai"
          disabled={!canTryAgain}
          onClick={onTryAgain}
        />
        <PillButton
          icon="autorenew"
          label="إعادة إنشاء"
          variant="ai"
          disabled={!canRegen}
          onClick={onRegen}
        />
        <PillButton
          icon="history"
          label="السجل"
          variant="glass"
          disabled={!canOpenHistory}
          onClick={() => {
            setHistoryOpen((v) => !v);
            onOpenHistory?.();
          }}
        />
        <PillButton
          icon={isLocked ? "lock" : "lock_open"}
          label={isLocked ? "مقفل — اضغط للإلغاء" : "قفل الشريحة"}
          variant={isLocked ? "cta" : "glass"}
          disabled={!canLock}
          onClick={onToggleLock}
        />
      </div>
    </div>
  );
}

function PillButton({
  icon,
  label,
  variant,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  variant: PillButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
}) {
  // Class composition per variant:
  //   glass → border + neutral glass surface (inline style)
  //   ai    → `.btn-gradient-anim` (animated mesh-stroke ring +
  //           hover fill, brand glow). No border utility needed —
  //           the class draws its own ::before ring.
  //   cta   → `.btn-gradient` (solid brand gradient fill + shadow).
  //           Active "locked" state for the Lock button. Pure class
  //           styling, no inline override.
  const variantClass =
    variant === "ai"
      ? "btn-gradient-anim hover:scale-[1.03]"
      : variant === "cta"
        ? "btn-gradient"
        : "border";
  const variantStyle = variant === "glass" ? NEUTRAL_GLASS_STYLE : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${BUTTON_BASE} ${variantClass}`}
      style={variantStyle}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
