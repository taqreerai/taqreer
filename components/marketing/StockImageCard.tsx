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
function thumbUrl(url: string): string {
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

export function StockImageCard({ image }: { image: StockImage }) {
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

  return (
    <div
      className={`group tq-thumbnail relative w-full overflow-hidden rounded-[14px] ${aspectClass(
        image.aspect,
      )}`}
    >
      {/* Image surface — a link to the full original (new tab). */}
      <a
        href={image.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t.viewFull}
        title={image.prompt}
        className="absolute inset-0 block h-full w-full"
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
            title={image.prompt}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
            onError={() =>
              attempt < 2 ? setAttempt((a) => a + 1) : setBroken(true)
            }
          />
        )}
      </a>

      {/* Hover / focus overlay: download button (top-end) + prompt caption
          (bottom). pointer-events-none so it never blocks the image link;
          the download link opts back in. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          background: "linear-gradient(to top, var(--tq-bg-dim), transparent 55%)",
        }}
      >
        <div className="flex justify-end">
          <a
            href={`/api/stock-images/download?id=${encodeURIComponent(image.id)}`}
            download
            aria-label={t.download}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-foreground transition-colors hover:text-foreground"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
          </a>
        </div>
        <p className="min-w-0 truncate text-[11px] font-semibold text-foreground">
          {image.prompt}
        </p>
      </div>
    </div>
  );
}
