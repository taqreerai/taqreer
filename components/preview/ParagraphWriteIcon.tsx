// Lazy-loading icon used on slide thumbnails that are mid-generation
// (see `SlideNavSidebar.tsx` placeholder state). Three rectangles
// animate left-to-right like a paragraph being typed, with staggered
// writes + cascading fade-outs that loop forever.
//
// Animation tokens live in the sibling `paragraph-write.css` — imported
// here so Turbopack ties it to this module's compile graph. Putting
// them in `globals.css` worked locally but the dev-server bundle was
// silently dropping the rules; co-locating the CSS with its consumer
// avoids that and matches Next's recommended pattern for component-
// scoped styles.

import "./paragraph-write.css";
//
// Sizing: pass `size` to control the rendered px (default 32). The
// `viewBox` is the original icon's 200×200 canvas, so any `size`
// scales uniformly. `currentColor` on the fills lets callers tint the
// icon via the parent's `color` (default white for dark backgrounds).
//
// Direction-awareness: `rtl={true}` mirrors the whole icon via the
// `data-rtl="true"` attribute the CSS picks up — the lines then grow
// from the right edge, matching Arabic deck flow. The DEFAULT is LTR
// so LTR languages (English etc.) don't need an explicit prop.

export function ParagraphWriteIcon({
  rtl = false,
  size = 32,
  className,
  // Animation mode:
  //   • "loop"  (default) — endless write + cascading fade-out
  //     used by the slide-nav placeholder cells.
  //   • "break" — one-shot variant for the 404 page: lines write
  //     in, hold briefly, then tilt + fall off-screen with a
  //     slight per-line rotation. `forwards` fill mode keeps them
  //     gone after the fall.
  //   • "hover" — STATIC rest state (all 3 lines fully visible) UNLESS
  //     an ancestor element carries the `.pw-hover-trigger` class AND
  //     is hovered, in which case the lines play the same loop as the
  //     default mode. Used by the dashboard sidebar logo so the icon
  //     sits idle as a brand mark and only "writes" while the user
  //     hovers the logo button. CSS in `paragraph-write.css` handles
  //     the gating.
  // The CSS in `paragraph-write.css` handles the actual keyframes;
  // this prop just sets the `data-mode` attribute the CSS gates on.
  mode = "loop",
}: {
  rtl?: boolean;
  size?: number;
  className?: string;
  mode?: "loop" | "break" | "hover";
}) {
  return (
    <svg
      className={`paragraph-write-icon${className ? ` ${className}` : ""}`}
      data-rtl={rtl ? "true" : undefined}
      data-mode={mode === "loop" ? undefined : mode}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden
    >
      <rect className="pw-line pw-line-1" x="41.06" y="26.92" width="117.31" height="26.01" fill="currentColor" />
      <rect className="pw-line pw-line-2" x="41.06" y="87.15" width="84.5" height="26.01" fill="currentColor" />
      <rect className="pw-line pw-line-3" x="41.06" y="147.39" width="117.31" height="26.01" fill="currentColor" />
    </svg>
  );
}
