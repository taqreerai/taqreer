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

import { useRef } from "react";

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
  // Receives the History trigger button's DOMRect so the parent
  // (DeckView) can anchor the popover under it. null when the
  // popover should close.
  onOpenHistory?: (triggerRect: DOMRect | null) => void;
  onToggleLock?: () => void;
};

// Common geometry for every button on the pill. Icon-only square,
// hover/disabled handled by Tailwind utilities. The actual
// background / border / glow surface comes from the per-variant
// class (`btn-gradient-anim`, `btn-gradient`, or the neutral glass
// recipe below). Centralised so the five buttons stay pixel-
// identical regardless of variant.
// Base geometry only — per-variant classes paint the text colour
// so the glass variant can run the muted→hover treatment without
// being overridden by a base `text-white`.
const BUTTON_BASE =
  "relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-40";

// Neutral glass surface — matches the normal-button treatment in
// PreviewActionBar so the pill reads as part of the same button
// vocabulary. Bg from the user's glass preset; border + text fade
// from muted (white/15, white/60) to bright (white/40, white)
// on hover. No raw `backdrop-filter` inline — the blur comes from
// the Tailwind `backdrop-blur-glass` utility (globals.css §3).
const NEUTRAL_GLASS_STYLE = {
  background: "rgba(255, 255, 255, var(--glass-opacity))",
} as const;
const NEUTRAL_GLASS_CLASSES =
  "border border-white/15 text-white/60 hover:border-white/40 hover:text-white";

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
  // Ref to the History button so the click handler can pass its
  // DOMRect upward. The parent renders the popover, anchored to
  // this rect. Open/closed state is owned by the parent (it's the
  // one that renders the portal'd popover) — having a local
  // "historyOpen" flag mirrored against parent state caused a
  // setState-during-render war earlier (parent's setState fired
  // from inside a SlidePill render-phase code path).
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);

  // Per the product spec: when no draft exists (slide is still at
  // v1), only Lock + Regen are active. Undo / Try again / History
  // grey out — the controls are visible (stable pill geometry)
  // but communicate "nothing to act on yet."
  const canUndo = currentVersionNumber > 1 && !isLocked && !busy;
  const canTryAgain = hasCachedComments && !isLocked && !busy;
  const canRegen = !isLocked && !busy;
  // History is always available (popover shows whatever rows exist).
  // Gating on `currentVersionNumber > 1` was wrong — after a Restore
  // back to v1 the user can still want to step FORWARD into v2 (the
  // row is preserved by Restore's non-destructive semantics).
  const canOpenHistory = !busy;
  const canLock = !busy;

  return (
    <div
      // top: 30px overlay above the slide; centered horizontally;
      // pointer-events:auto so child clicks land (parent canvas may
      // have crosshair cursor during comment mode — we don't want
      // the pill to take that styling).
      className="pointer-events-auto absolute left-1/2 z-20 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover/canvas:opacity-100"
      style={{ top: 30 }}
    >
      <div
        // Pattern 3 (Layout surface) via `.glass-popover` — the
        // canonical dark-tinted glass popover defined in globals.css.
        // Tailwind utilities supply the blur + saturate as required
        // by globals.css §"backdrop-filter"; raw `backdrop-filter`
        // would lose to Tailwind's compositional rule. Bg + border
        // come from the class so we stay preset-aware without
        // hardcoding any colour or alpha.
        className="glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] flex items-center gap-2.5 rounded-full px-2.5 py-2"
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
          label="حاول بالتعليقات مرة أخرى"
          variant="ai"
          disabled={!canTryAgain}
          onClick={onTryAgain}
        />
        <PillButton
          icon="autorenew"
          label="إعادة إنشاء هذه الشريحة"
          variant="ai"
          disabled={!canRegen}
          onClick={onRegen}
        />
        <PillButton
          icon="history"
          label="السجل"
          variant="glass"
          disabled={!canOpenHistory}
          buttonRef={historyBtnRef}
          onClick={() => {
            onOpenHistory?.(
              historyBtnRef.current?.getBoundingClientRect() ?? null,
            );
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
  buttonRef,
  onClick,
}: {
  icon: string;
  label: string;
  variant: PillButtonVariant;
  disabled?: boolean;
  // Optional — only used by the History button so the parent can
  // measure the trigger and anchor a popover under it.
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
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
  // Glass variant composes the preset-linked blur via the Tailwind
  // `backdrop-blur-glass` utility (NOT raw `backdrop-filter` — see
  // globals.css §3 / Pattern 3) AND the muted→hover treatment from
  // PreviewActionBar so the pill reads as part of the same button
  // vocabulary. AI + CTA variants paint their own surfaces via the
  // global classes and ship as white text.
  const variantClass =
    variant === "ai"
      ? "btn-gradient-anim text-white hover:scale-[1.03]"
      : variant === "cta"
        ? "btn-gradient text-white"
        : `backdrop-blur-glass ${NEUTRAL_GLASS_CLASSES}`;
  const variantStyle = variant === "glass" ? NEUTRAL_GLASS_STYLE : undefined;
  return (
    // Named `group/btn` so the tooltip's `group-hover/btn:` matches
    // THIS wrapper specifically, leaving the outer `group/canvas`
    // (used by the pill's overall fade-in) untouched.
    <span className="group/btn relative inline-flex">
      <button
        ref={buttonRef}
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
      {/* Tooltip — appears BELOW the button so it doesn't clash with
          the slide content above the pill. Same recipe as
          PreviewActionBar (Pattern 1 vocabulary, see globals.css). */}
      <span
        className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover/btn:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
