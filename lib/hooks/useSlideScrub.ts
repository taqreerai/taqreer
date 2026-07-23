"use client";

// Hover-scrub through a list of slide images — shared by the project
// cards (ProjectThumbnail) and the template tiles (TemplateTile).
//
// Cursor X over the surface maps linearly to a slide index (RTL:
// rightmost pixel = slide 1, leftmost = slide N). The first mousemove
// just records the entry X, so a bare resting hover doesn't trigger a
// scrub; leaving the surface snaps back to the cover (index 0). The
// first few images are eager-preloaded on mount so the first scrub is
// instant.
//
// The consumer owns the surface ref (a <button> on the project tile, a
// <div> on the template tile) + passes it in; the hook reads `.current`
// only inside the mousemove handler.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

// Pixels of cursor travel required before scrubbing kicks in (vs. a
// resting hover). ~2 trackpad ticks.
const SCRUB_ACTIVATION_PX = 6;
// Cap on eager-preloaded images. A 6-tile dashboard × 8 slides each would
// be 48 simultaneous fetches on first paint without the cap; 3 keeps it
// to ~18. Slides beyond the cap fetch on first hover (cheap). Template
// tiles only have 3 showcase PNGs, so this preloads all of them.
const EAGER_PRELOAD_LIMIT = 3;
// Hard cap on how many slides hover-scrub reveals, for EVERY surface
// (project decks + template tiles, all tiers). A 30-slide deck would
// otherwise map ~10 px of cursor travel to a new slide — a jittery,
// hard-to-aim scrub that also preloads dozens of images. The first 5
// are a plenty representative teaser; the full deck is one click away.
export const SCRUB_SLIDE_LIMIT = 5;

export function useSlideScrub<T extends HTMLElement>(
  slides: string[],
  surfaceRef: RefObject<T | null>,
) {
  const entryXRef = useRef<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Only the first N slides participate in the scrub. Memoized so the
  // preload effect (keyed on array identity) doesn't re-run every render.
  const scrubSlides = useMemo(
    () => slides.slice(0, SCRUB_SLIDE_LIMIT),
    [slides],
  );

  const isMultiSlide = scrubSlides.length > 1;
  const displayIndex = hoverIndex ?? 0;

  // Eager-preload the first few scrub images on mount.
  useEffect(() => {
    for (const url of scrubSlides.slice(0, EAGER_PRELOAD_LIMIT)) {
      if (!url) continue;
      const img = new Image();
      img.src = url;
    }
    // Keyed on the array identity — re-runs if the slide list changes.
  }, [scrubSlides]);

  const handleMouseMove = (e: { clientX: number }) => {
    if (!isMultiSlide) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (entryXRef.current == null) {
      entryXRef.current = e.clientX;
      return;
    }
    if (Math.abs(e.clientX - entryXRef.current) < SCRUB_ACTIVATION_PX) return;
    const relX = e.clientX - rect.left;
    // RTL mapping: rightmost pixel = slide 1, leftmost = slide N (N ≤ cap).
    const idx = Math.min(
      scrubSlides.length - 1,
      Math.max(
        0,
        Math.floor(((rect.width - relX) / rect.width) * scrubSlides.length),
      ),
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    entryXRef.current = null;
  };

  return {
    hoverIndex,
    displayIndex,
    isMultiSlide,
    // Number of slides the scrub actually spans (≤ SCRUB_SLIDE_LIMIT). The
    // counter chip reads off this, not the full deck length, so a 30-slide
    // deck shows "3 / 5" instead of an unreachable "3 / 30".
    scrubCount: scrubSlides.length,
    handleMouseMove,
    handleMouseLeave,
  };
}
