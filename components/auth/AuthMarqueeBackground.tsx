/* eslint-disable @next/next/no-img-element -- thumbnail src is a generated storage/data URL; next/image's host allowlist + optimization don't apply */
// Background mosaic behind the auth-page glass modal — 12 vertical
// columns of project thumbnails, each scrolling slowly in alternating
// directions. Reads as a "living wall" of decks the platform has
// generated; thumbnails are duplicated 3× per column so the seamless
// CSS-keyframe loop (`scroll-vertical-down` / `scroll-vertical-up`)
// can translate by -33.33% and wrap without visible discontinuity.
//
// All motion is GPU-only (`transform: translateY`); no layout thrash.
// `will-change: transform` is set on the inner column from the utility
// classes so the compositor promotes each column to its own layer.
//
// Privacy note: data source (random rows from `Project` regardless of
// share state) lives in `lib/auth/marquee-projects.ts` — the scope
// trade-off is documented there.

import React from "react";
import type { MarqueeColumns } from "@/lib/auth/marquee-projects";

// Native `<img>` is intentional — matches `ProjectThumbnail` (the
// canonical thumb renderer) which also bypasses `next/image`. Supabase
// storage URLs (the project thumbnail source) are not in our
// `next.config.ts` `remotePatterns` allow-list, and adding them just
// for a decorative background would be the wrong knob to pull.

// Deterministic 0–1200 ms delay derived from the tile's composite id
// (`<projectId>-<slideIndex>`). Tightened from 4500 ms (user
// direction 2026-05-28 — some tiles were taking too long to appear).
// With the 2.5 s fade-in duration, the last tile now settles at
// ~3.7 s instead of ~7 s, so the wall reads as a quick wave rather
// than a long drawn-out cascade. Deterministic (not Math.random())
// so the SSR HTML and first client render match — no hydration
// mismatch or re-flash on hydration.
function delayMsFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1200;
}

type Props = {
  columns: MarqueeColumns;
};

export function AuthMarqueeBackground({ columns }: Props) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* `gap-4` between columns. 30° clockwise rotation tilts the
          whole wall — the corners stick past the viewport edges so
          the inner div is scaled up to keep the rotated wall
          covering edge-to-edge without exposed gaps.

          Scale math (2026-05-28): for a viewport of vw × vh rotated
          by θ around its center, the worst-case viewport corner
          sits at (vw/2·cos + vh/2·sin, -vw/2·sin + vh/2·cos) in the
          rect's local frame. At 30° on a 1440×900 viewport the
          worst corner needs the rect's HALF-HEIGHT ≥ ~750 px, so
          scale ≥ 750/450 = 1.67. Earlier `scale(1.4)` exposed the
          corners; `scale(1.8)` covers with safety margin for varied
          aspect ratios. The 1.8× also visually enlarges each tile,
          which reads better at the new 4-col density.

          Center-fade overlay is a sibling — not rotated — so the
          modal halo stays anchored in screen space. */}
      <div
        className="absolute inset-0 flex gap-4"
        style={{
          transform: "rotate(30deg) scale(1.8)",
          transformOrigin: "center center",
        }}
      >
        {columns.map((col, columnIndex) => (
          <MarqueeColumn
            key={columnIndex}
            thumbnails={col}
            direction={columnIndex % 2 === 0 ? "down" : "up"}
            // Slight per-column animation-delay so columns don't all
            // start at the same point in the loop — gives the wall a
            // "woven" cadence instead of a single sync'd conveyor belt.
            delayMs={(columnIndex * 800) % 4000}
          />
        ))}
      </div>

      {/* Dim overlay removed per user direction 2026-05-28 — was
          `bg-[#00000030]` (≈19 % black wash). The modal's heavy
          backdrop blur + the center radial fade (below) already
          give the modal enough separation from the marquee wall;
          the flat dim was stacking with the center fade and pulling
          the wall corners darker than needed. The violet glow stays
          owned by the layout root's `.dashboard-bg::before` (bottom-
          anchored radial, globals.css). */}

      {/* Center fade — pure background-image (no mask) so Safari
          doesn't composite the columns into a stalled subtree.
          Dialed back from full-opaque `var(--tq-bg) 25%` to
          `color-mix(--tq-bg 55% / transparent)` so the marquee
          partially reads through the center too — useful for
          debugging "is the scroll even running" AND lets the wall
          breathe through the modal halo. Edges stay fully transparent
          so the corners show the columns crisply. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 110% 110% at 50% 50%, color-mix(in srgb, var(--tq-bg) 55%, transparent) 25%, rgba(0,0,0,0) 105%)",
        }}
      />
    </div>
  );
}

function MarqueeColumn({
  thumbnails,
  direction,
  delayMs,
}: {
  thumbnails: { id: string; thumbnail: string; format: string }[];
  direction: "down" | "up";
  delayMs: number;
}) {
  // Empty-column fallback: render a transparent placeholder so the
  // column layout stays at the same 1/12 width even on a fresh DB.
  if (thumbnails.length === 0) {
    return <div className="flex-1" />;
  }

  return (
    <div className="flex-1 overflow-hidden">
      {/* `h-max` matches the working `TemplatesScroll` recipe on the
          marketing landing — same keyframes, same `h-max`. Reverted
          from the earlier `h-auto` attempt: Safari handles
          `height: max-content` correctly here when the children sit
          inside a `flex flex-col` with explicit `gap`. Animation
          delay is negative so each column enters mid-loop rather
          than all kicking off at zero (woven cadence). */}
      <div
        className={`flex h-max w-full flex-col gap-4 ${
          direction === "down" ? "animate-scroll-down-slow" : "animate-scroll-up-slow"
        }`}
        style={{ animationDelay: `-${delayMs}ms` }}
      >
        {[0, 1, 2].map((setIndex) => (
          <React.Fragment key={setIndex}>
            {thumbnails.map((thumb) => (
              <div
                key={`${setIndex}-${thumb.id}`}
                // `tile-fade-in` starts at opacity 0 and animates to
                // opacity 1 over 1.4 s with `forwards`. Per-tile
                // delay is derived from the id hash so each tile
                // lights up at its own moment — the wall fills in
                // like a slow Polaroid wave rather than all-at-once.
                // All 3 setIndex copies share the same id-derived
                // delay so the duplicates fade in alongside their
                // originals (no out-of-sync visual). After the
                // initial fade completes, the column keeps scrolling
                // — `forwards` pins opacity:1 so wrap-around never
                // re-fades.
                className="tile-fade-in w-full shrink-0 overflow-hidden rounded-lg"
                style={{
                  // 16:9 vs 9:16 — drives natural aspect mix across the
                  // column so the mosaic isn't visually monotone.
                  // Border removed per user direction 2026-05-28 — the
                  // tiles were carrying a 1 px white-glass ring
                  // (`--tq-border-opacity`) that read as a grid of
                  // cells against the heavy modal blur. Plain edges
                  // let the mosaic feel like a single canvas.
                  aspectRatio: thumb.format === "9:16" ? "9 / 16" : "16 / 9",
                  animationDelay: `${delayMsFromId(thumb.id)}ms`,
                }}
              >
                {/* Background decoration — `loading="lazy"` so the
                    initial paint isn't blocked, `decoding="async"` so
                    a broken thumb doesn't stall the column.
                    `image-rendering: high-quality` + the GPU-layer
                    hint (`translateZ(0)` + `backface-visibility:
                    hidden`) push the browser to use better
                    interpolation for the `rotate(30deg) scale(1.8)`
                    on the column parent — without these, retina
                    displays show the source 800×450 thumbnails
                    softened to look noticeably blurry under the
                    rotation's bilinear default. */}
                <img
                  src={thumb.thumbnail}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  style={{
                    // `high-quality` is a valid CSS value (since CSS
                    // Images 4) but TS's `ImageRendering` lib type
                    // hasn't been updated; cast keeps the property in
                    // place without weakening other types.
                    imageRendering: "high-quality" as React.CSSProperties["imageRendering"],
                    transform: "translateZ(0)",
                    backfaceVisibility: "hidden",
                  }}
                />
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
