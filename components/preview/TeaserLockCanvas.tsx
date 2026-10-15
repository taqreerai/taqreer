"use client";

// Teaser paywall locked slide (free-tier conversion). The last N slides of a
// free deck are WITHHELD - never generated - and shown here as a locked slot:
// a blurred invented layout in the deck's own colours (TeaserGhostSlide, the
// same drawing as the slot's side-panel tile) under a light scrim, plus an
// unlock CTA. Falls back to the palette gradient when there is no ghost. There
// is NO real content behind it (nothing to bypass); the actual slide is
// authored (on Opus, comped) only when the owner subscribes.
//
// Rendered in place of the focused slide; DeckView positions the host rect
// (viewer artboard or the edit-mode fit rect) exactly like the regen overlay.

import type { ReactNode } from "react";

type TeaserLockCanvasProps = {
  // CSS background built from the deck palette, one per locked slot (see
  // teaserGradient in DeckView). Random-but-stable per slot.
  gradient: string;
  // The slot's blurred ghost slide; null = the gradient alone.
  ghost?: ReactNode;
  onUnlock: () => void;
  unlocking?: boolean;
  labels: { cta: string; unlocking: string };
};

export function TeaserLockCanvas({
  gradient,
  ghost = null,
  onUnlock,
  unlocking = false,
  labels,
}: TeaserLockCanvasProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: gradient }}
    >
      {ghost}
      <div className={`tq-teaser-lock-scrim${ghost ? " is-ghost" : ""}`}>
        <span
          className="material-symbols-outlined tq-teaser-lock-icon"
          style={{ fontSize: 44 }}
          aria-hidden
        >
          lock
        </span>
        <button
          type="button"
          onClick={onUnlock}
          disabled={unlocking}
          className="btn-gradient px-5 py-2.5 text-sm"
        >
          {unlocking ? labels.unlocking : labels.cta}
        </button>
      </div>
    </div>
  );
}
