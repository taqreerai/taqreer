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
// call as LibraryImageCard / TemplateTile), with the STATIC pre-generated
// thumbnail (gen-thumb.tsx — replaced the billed render/image transforms)
// + onError escalation so tiles load fast and a missing thumb or transient
// drop self-heals instead of leaving a blank cell.

import { useDict } from "@/components/i18n/LocaleProvider";
import { useThumbSrc } from "@/components/app/gen-thumb";
import { prefetchRelated } from "@/components/marketing/stockImagesCache";
import type { StockImage } from "@/lib/stock-images/query";

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
  // Static thumb + escalation ladder (thumb → cache-bust → full original).
  const { src, key, broken, onError } = useThumbSrc(image.url);

  // The whole tile is the open-button — no hover overlay (prompt + download
  // live in the lightbox now). A subtle zoom on hover is the only affordance.
  return (
    <button
      type="button"
      onClick={() => onOpen(image)}
      // Warm this image's deck group before the click lands, so the lightbox
      // can paint its suggestions immediately instead of popping them in late
      // (which shoved the download button up). No-ops once cached/in-flight.
      onMouseEnter={() => prefetchRelated(image.id)}
      onFocus={() => prefetchRelated(image.id)}
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
          key={key}
          src={src}
          alt={image.prompt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={onError}
        />
      )}
    </button>
  );
}
