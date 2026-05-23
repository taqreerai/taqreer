"use client";

// Per-slide floating control pill. Sits above the hero slide with a
// 30 px top margin, fades in on canvas hover, fades out when the
// mouse leaves the canvas. Owns the per-slide actions that operate
// on the currently-focused slide:
//
//   ↻ Regen      Clean partial regen (no comments)              [AI]
//   ⌛ History   Open the version list popover
//   🔒 Lock      Lock this slide against full-deck regen        [CTA when active]
//
// History notes:
// - Undo removed 2026-05-20 — History + Restore handle every "go
//   back" path non-destructively, and the destructive Undo
//   muddled the mental model.
// - Try Again (replay cached comments) removed 2026-05-20 —
//   narrow utility for the complexity it added. Users iterate by
//   adjusting comments via the comment bar, not by re-rolling
//   identical comments hoping for different output. The server-
//   side cache infrastructure (SlideState.cachedComments + /regen
//   replay flag) is kept dormant for now; no UI surfaces it.
//
// STYLING (matches globals.css design vocabulary):
//   - Try again + Regen use `.btn-gradient-anim` (Pattern 4 — AI
//     trigger). The animated mesh-gradient stroke is the brand cue
//     for "Claude does work here", same as the regen toolbar button.
//   - Lock when active uses `.btn-gradient` (Pattern 2 — CTA, brand
//     gradient fill + shadow). When unlocked it's neutral glass.
//   - History stays neutral glass (Pattern 1 — normal button)
//     matching the PreviewActionBar muted→hover treatment.
//   - Geometry is icon-only square (h-9 w-9) so the bar fits inside
//     both 16:9 and 9:16 slide canvases without overflowing.
//
// Visibility rules:
//   - Lock + Regen are ALWAYS visible
//   - Try again appears only when there's a cached comment payload
//   - History is always visible; popover shows what rows exist

import { useRef } from "react";

export type SlidePillState = {
  currentVersionNumber: number;
  isLocked: boolean;
  // Disables every button (including Lock + Regen) while a regen
  // is mid-flight for this slide. Avoids double-clicks while the
  // hero overlay is up.
  busy?: boolean;
};

export type SlidePillProps = SlidePillState & {
  onRegen?: () => void;
  // Receives the History trigger button's DOMRect so the parent
  // (DeckView) can anchor the popover under it. The parent owns
  // the popover open/closed state — pill is stateless here.
  onOpenHistory?: (triggerRect: DOMRect | null) => void;
  onToggleLock?: () => void;
  // True while THIS slide's history popover is open. Forces the
  // pill to stay fully opaque even though the cursor has moved
  // onto the (portal'd) popover and left the canvas's hover area.
  popoverOpen?: boolean;
};

// Common geometry for every button on the pill. Icon-only square,
// hover/disabled handled by Tailwind utilities. The actual
// background / border / glow surface comes from the per-variant
// class (`btn-gradient-anim`, `btn-gradient`, or the neutral glass
// recipe below). Centralised so the five buttons stay pixel-
// identical regardless of variant.
// Base geometry only — fixed 36 × 36 square, padding zeroed so
// `.btn-pill`'s default 6 × 12 padding doesn't crop the centred
// icon. Per-variant classes paint colour + (for AI/CTA) surface.
const BUTTON_BASE =
  "relative inline-flex h-9 w-9 items-center justify-center rounded-full p-0! transition-all disabled:cursor-not-allowed disabled:opacity-40";

// Glass-variant buttons consume the canonical `.btn-pill` class
// (globals.css §"Normal-button surface"). It's transparent +
// muted-border + muted-text, fading to bright on hover. Lives in
// globals.css as the single source of truth — DO NOT inline a
// custom border / text recipe here.

type PillButtonVariant = "glass" | "ai" | "cta";

export function SlidePill({
  currentVersionNumber: _currentVersionNumber,
  isLocked,
  busy = false,
  popoverOpen = false,
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

  // Per the product spec: Lock + Regen are always available.
  // History is always available (popover shows whatever rows
  // exist) — gating on a version count would have blocked the
  // redo-after-restore path (rows survive a non-destructive
  // restore).
  const canRegen = !isLocked && !busy;
  const canOpenHistory = !busy;
  const canLock = !busy;

  return (
    <div
      // Outer = positioning only. NO opacity transition here (was
      // here originally; moved to the inner element with the
      // backdrop-filter on 2026-05-23). With opacity on an ancestor
      // of a backdrop-filter element, the browser keeps the filter
      // fully computed until opacity hits exactly 0, then drops it
      // in a jump — so the blur "doesn't fade out", which is what
      // the user reported. Putting opacity on the SAME element as
      // backdrop-filter (option b in the TemplateLightbox header
      // note) lets the browser correlate the two: as opacity drops,
      // the filter is implicitly faded with it.
      //
      // `pointer-events-none` here so clicks fall through the
      // invisible bounding box; the inner re-enables pointer-events
      // only when actually visible (see its className).
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2"
      style={{ top: 30 }}
    >
      <div
        // Inner = bg + blur + content + opacity transition. Blur
        // restored here (was stripped in the previous attempt
        // because backdrop-filter wouldn't fade with an
        // ancestor-driven opacity; now opacity is on this same
        // element so the fade works). 0.55 alpha on var(--tq-bg)
        // (#0E0E18) keeps the pill visible against white slides.
        //
        // `pointer-events-auto` is gated on visibility so the pill
        // only catches clicks when the canvas is hovered (or the
        // history popover is open). Without this gating, clicks
        // would silently land on an invisible pill.
        className={`glass-popover slides_pill backdrop-blur-glass backdrop-saturate-(--glass-saturation) flex items-center gap-2.5 rounded-full px-2.5 py-2 transition-opacity duration-150 ${
          popoverOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0 group-hover/canvas:pointer-events-auto group-hover/canvas:opacity-100"
        }`}
        style={{
          backgroundColor: "rgba(14, 14, 24, 0.55)",
        }}
      >
        <PillButton
          icon="autorenew"
          label="أعد تصميم الشريحة"
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
          // `data-history-trigger` lets HistoryPopover's outside-click
          // handler skip closing when the user clicks this button —
          // the parent's onOpenHistory owns the toggle. Without the
          // exclusion the mousedown closes the popover, then the
          // click re-opens it, breaking second-click-to-dismiss.
          dataAttr={{ "data-history-trigger": "true" }}
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
  dataAttr,
  onClick,
}: {
  icon: string;
  label: string;
  variant: PillButtonVariant;
  disabled?: boolean;
  // Optional — only used by the History button so the parent can
  // measure the trigger and anchor a popover under it.
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  // Optional data-* attributes spread onto the underlying <button>.
  // Used to stamp `data-history-trigger` so HistoryPopover can
  // exclude this button from its outside-click handler.
  dataAttr?: Record<string, string>;
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
  // Variant chrome — all three pull from globals.css classes:
  //   glass → `.btn-pill` (transparent normal-button, Pattern 1)
  //   ai    → `.btn-gradient-anim` (animated mesh-stroke, Pattern 4)
  //   cta   → `.btn-gradient` (brand gradient + shadow, Pattern 2)
  const variantClass =
    variant === "ai"
      ? "btn-gradient-anim text-white hover:scale-[1.03]"
      : variant === "cta"
        ? "btn-gradient text-white"
        : "btn-pill";
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
        {...(dataAttr ?? {})}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {icon}
        </span>
        <span className="sr-only">{label}</span>
      </button>
      {/* Tooltip — appears BELOW the button so it doesn't clash with
          the slide content above the pill. Same recipe as
          PreviewActionBar (Pattern 1 vocabulary, see globals.css).
          `dir="auto"` so Arabic UI labels ("السجل", "قفل الشريحة")
          render RTL even when the surrounding canvas is an EN deck
          (manifest.direction === "ltr" → ancestor dir flips LTR →
          tooltip text would otherwise inherit LTR and render the
          Arabic word with mis-placed inline punctuation / mixed-
          script runs). Auto = first strong directional character
          wins, so each tooltip gets the right direction for free. */}
      <span
        dir="auto"
        className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover/btn:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
