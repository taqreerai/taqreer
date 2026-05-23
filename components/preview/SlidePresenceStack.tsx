"use client";

// Stack of presence avatars overlaid on a single slide thumbnail.
//
// Mounted by SlideNavSidebar in the top-start (RTL: top-right) corner
// of each thumbnail button. Caller filters to viewers currently
// focused on THIS slide and excludes the current user (self) — we
// just render whatever we get. Empty array → nothing rendered.
//
// Geometry:
//   • 20×20 avatars (smaller than the 24×24 CommentsPanel chip — the
//     thumbnail itself is only 109 px wide so 20 keeps the stack
//     comfortably under 30 % of the thumbnail width even with two
//     viewers overlapping).
//   • First two avatars stack with `margin-inline-start: -6px` on the
//     second so they overlap by ~30 %. RTL-aware: under `dir="rtl"`
//     the inline-start is the right edge, so the second avatar nudges
//     LEFT into the first — the "stacked planets" effect described
//     in the user's brief.
//   • A 1px white/40 ring on every chip separates overlapping
//     avatars visually (without the ring the magenta + blue gradients
//     blur into each other).
//   • 3+ viewers → first two avatars + a "+N" glass chip. Cap matches
//     the realistic concurrent-viewer count for a project (2-4).
//
// `pointer-events: none` everywhere so the stack never blocks the
// thumbnail click.

import { Avatar } from "@/components/common/Avatar";
import type { PresenceViewer } from "@/lib/realtime/project-channel";

const MAX_AVATARS = 2;
const AVATAR_PX = 20;

export function SlidePresenceStack({ viewers }: { viewers: PresenceViewer[] }) {
  if (viewers.length === 0) return null;
  const visible = viewers.slice(0, MAX_AVATARS);
  const overflow = viewers.length - visible.length;

  return (
    <div
      // PHYSICAL top-left, not logical top-start, on purpose: the
      // visual position is "top-left of the visible thumbnail" per
      // the user's spec — staying physical avoids the logical-
      // property flip that would put avatars on the right edge for
      // Arabic decks (where the slide-nav uses `dir="rtl"`).
      // Inline `style` over Tailwind utilities here so we don't
      // depend on whether Tailwind v4 generates the `left-N` class
      // for this file before the next dev-server scan.
      // `pointer-events: none` so clicks fall through to the thumbnail
      // button; individual avatars don't intercept either.
      className="pointer-events-none absolute flex items-center"
      style={{ top: 4, left: 4 }}
      // No `gap` — the second avatar uses negative left margin
      // for the overlap, which `gap` would override.
    >
      {visible.map((viewer, idx) => (
        <div
          key={viewer.userId}
          // `display: flex` on the wrapper (not the default `block`)
          // so the Avatar inside is a flex item, NOT an inline-level
          // element. Inline-level <img> baselines = bottom of image
          // (sits flush with line-box top), but inline-level
          // <div class="inline-flex"> baselines = the text baseline
          // INSIDE the chip, which is ~7 px below center for a font-
          // semibold letter — that shifted the gradient chip ~7 px
          // DOWN relative to the image chip in the same container.
          // Making the wrapper a flex container bypasses inline
          // baseline alignment entirely; both chips end up at top:0
          // of their wrapper.
          //
          // Negative LEFT (not inline-start) margin so the overlap
          // direction stays consistent with the stack's LTR layout
          // even on Arabic decks.
          style={{
            display: "flex",
            marginLeft: idx === 0 ? 0 : -6,
          }}
        >
          <Avatar
            name={viewer.name}
            image={viewer.avatar}
            seedId={viewer.userId}
            size={AVATAR_PX}
            inactive={!viewer.tabActive}
            // White ring separates overlapping chips. 40 % opacity is
            // dim enough to not compete with the gradients but visible
            // against any slide colour underneath.
            ringColor="rgba(255, 255, 255, 0.4)"
          />
        </div>
      ))}
      {overflow > 0 ? (
        <div
          aria-label={`و${overflow} آخرين`}
          className="-ms-[6px] flex items-center justify-center rounded-full bg-black/60 font-semibold text-white"
          style={{
            width: AVATAR_PX,
            height: AVATAR_PX,
            fontSize: 9,
            boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.4)",
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
