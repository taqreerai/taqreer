"use client";

// Teaser paywall locked slide (free-tier conversion). The last N slides of a
// free deck are WITHHELD - never generated - and shown here as a locked slot:
// a random gradient built from the DECK's own palette under a dark scrim, plus
// an unlock CTA. There is NO real content behind it (nothing to bypass); the
// actual slide is authored (on Opus, comped) only when the owner subscribes.
//
// Rendered in place of the focused slide; DeckView positions the host rect
// (viewer artboard or the edit-mode fit rect) exactly like the regen overlay.

type TeaserLockCanvasProps = {
  // CSS background built from the deck palette, one per locked slot (see
  // teaserGradient in DeckView). Random-but-stable per slot.
  gradient: string;
  onUnlock: () => void;
  unlocking?: boolean;
  labels: { cta: string; unlocking: string };
};

export function TeaserLockCanvas({
  gradient,
  onUnlock,
  unlocking = false,
  labels,
}: TeaserLockCanvasProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: gradient }}
    >
      <div className="tq-teaser-lock-scrim">
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
