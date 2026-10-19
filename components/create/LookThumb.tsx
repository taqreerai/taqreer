"use client";

// Real-slide thumbnails for the deck looks (2026-10-19): each look has a short
// sample deck generated with that look (public/looks/<locale>/<key>-<n>.webp,
// slides 1 to 3), shown like the template tiles: the cover at rest, hover
// scrubs through the slides. Looks without captured slides for the locale keep
// the drawn StyleThumb.

import { useMemo, useRef } from "react";
import { ScrubCounter } from "@/components/app/ScrubCounter";
import { useSlideScrub } from "@/lib/hooks/useSlideScrub";

const LOOK_SLIDES = 3;

// Looks with captured slides, per locale. The photo-led looks (minimal,
// editorial, duotone, playful, organic, collage) follow once their sample
// decks have their generated photos.
const LOOK_THUMBS: Record<string, ReadonlySet<string>> = {
  ar: new Set([
    "swiss",
    "corporate",
    "bold",
    "brutalist",
    "classroom",
    "earlyyears",
    "primary",
    "middleschool",
    "highschool",
    "university",
    "official",
    "heritage",
    "luxury",
    "techglass",
    "startup",
    "infographic",
    "sketch",
    "retro",
    "whiteboard",
  ]),
};

export function hasLookThumb(locale: string, key: string): boolean {
  return LOOK_THUMBS[locale]?.has(key) ?? false;
}

export function LookThumb({ k, locale }: { k: string; locale: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const slides = useMemo(
    () => Array.from({ length: LOOK_SLIDES }, (_, i) => `/looks/${locale}/${k}-${i + 1}.webp`),
    [k, locale],
  );
  const scrub = useSlideScrub(slides, ref);
  return (
    <div
      ref={ref}
      onMouseMove={scrub.handleMouseMove}
      onMouseLeave={scrub.handleMouseLeave}
      className="relative w-full overflow-hidden rounded-md border border-[var(--tq-border-hairline)]"
      style={{ aspectRatio: "16/9" }}
    >
      {/* Static files under public/, same native <img> as the template tiles. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slides[scrub.displayIndex]}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {scrub.hoverIndex !== null ? (
        <ScrubCounter index={scrub.hoverIndex} total={scrub.scrubCount} />
      ) : null}
    </div>
  );
}
