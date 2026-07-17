"use client";

// One tile in the public /free-stock-images masonry.
//
// Unsplash-style: the tile keeps the image's NATURAL aspect (landscape /
// portrait / square) so the masonry reads as a real photo wall. The
// PROMPT is the alt / title / hover caption (never the deck title —
// privacy). Clicking opens the full original in a new tab; a hover
// button downloads it via the same-origin attachment proxy.
//
// Native <img> (Supabase storage host isn't in next remotePatterns, same
// call as LibraryImageCard / TemplateTile), with the same resized-
// thumbnail transform + onError escalation so tiles load fast and a
// transient drop self-heals instead of leaving a blank cell.

import { useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import type { StockImage } from "@/lib/stock-images/query";

// Resized-thumbnail URL via Supabase's image-transform endpoint. A
// generated image is a full-resolution JPEG (~0.5-2 MB); a masonry tile
// renders it small. Rewriting the public-object URL to the render/image
// path serves a ~30 KB webp instead. CRITICAL: pass a width+height
// BOUNDING BOX with resize=contain (width-only squishes the image — see
// LibraryImageCard for the full note). Non-storage URLs pass through.
const OBJECT_MARKER = "/storage/v1/object/public/";
export function thumbUrl(url: string): string {
  if (!url.includes(OBJECT_MARKER)) return url;
  const rendered = url.replace(OBJECT_MARKER, "/storage/v1/render/image/public/");
  const sep = rendered.includes("?") ? "&" : "?";
  return `${rendered}${sep}width=700&height=700&resize=contain&quality=60`;
}

// Natural-aspect box per orientation (matches the gpt-image output sizes:
// landscape 3:2, portrait 2:3, square 1:1) so object-cover barely crops.
function aspectClass(aspect: string): string {
  if (aspect === "portrait") return "aspect-[2/3]";
  if (aspect === "square") return "aspect-square";
  return "aspect-[3/2]";
}

export function StockImageCard({
  image,
  onOpen,
}: {
  image: StockImage;
  onOpen: (image: StockImage) => void;
}) {
  const dict = useDict();
  const t = dict.stockImages;
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);

  const thumb = thumbUrl(image.url);
  // Attempt 0: resized thumbnail. 1: cache-busted retry. 2: full original.
  const src =
    attempt === 0
      ? thumb
      : attempt === 1
        ? `${thumb}${thumb.includes("?") ? "&" : "?"}retry=1`
        : image.url;

  // The whole tile is the open-button — no hover overlay (prompt + download
  // live in the lightbox now). A subtle zoom on hover is the only affordance.
  return (
    <button
      type="button"
      onClick={() => onOpen(image)}
      // The PROMPT (not a generic label) so every tile has a distinct
      // accessible name — a shared "view image" label makes the grid
      // unnavigable by screen reader.
      aria-label={`${t.viewFull}: ${image.prompt}`}
      className={`group tq-thumbnail relative block w-full overflow-hidden rounded-[14px] ${aspectClass(
        image.aspect,
      )}`}
    >
      {broken ? (
        <div className="flex h-full w-full items-center justify-center bg-[var(--tq-bg-dim)]">
          <span className="material-symbols-outlined text-[26px] text-muted/50">
            image
          </span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={src}
          alt={image.prompt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={() =>
            attempt < 2 ? setAttempt((a) => a + 1) : setBroken(true)
          }
        />
      )}
    </button>
  );
}
