// Route-transition skeleton for /free-stock-images. Mirrors THIS page's
// shape (centered hero → controls row → masonry), not the generic browse
// skeleton — the hero is centered and the grid is a multi-column masonry.
// Token-only + aria-hidden; the real content replaces it moments later.

import { SkeletonBar } from "@/components/app/PageSkeletons";

// Varied tile heights so the ghost reads as a masonry wall, not a grid.
const TILE_HEIGHTS = [300, 220, 260, 200, 320, 240, 280, 210, 300, 250, 230, 290];

export default function Loading() {
  return (
    <div aria-hidden="true" className="pb-8">
      {/* Centered hero. */}
      <section className="flex flex-col items-center gap-4 pb-12 text-center">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-10 w-80 max-w-full rounded-lg" />
        <SkeletonBar className="h-5 w-96 max-w-full" />
      </section>

      {/* Controls row: search + orientation filter. */}
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SkeletonBar className="h-10 w-64 max-w-full rounded-full" />
        <SkeletonBar className="ms-auto h-10 w-56 rounded-full" />
      </div>

      {/* Masonry ghost (3 columns). */}
      <div className="columns-2 gap-4 md:columns-3">
        {TILE_HEIGHTS.map((h, i) => (
          <div
            key={i}
            style={{ height: h }}
            className="mb-4 w-full break-inside-avoid rounded-[14px] bg-[var(--tq-overlay-soft)]"
          />
        ))}
      </div>
    </div>
  );
}
