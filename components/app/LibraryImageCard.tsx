"use client";

import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useThumbSrc } from "@/components/app/gen-thumb";

// One image tile in the /library grid.
//
// Matches the /projects thumbnail (aspect-video, tq-thumbnail). The
// IMAGE is a button that opens the expand modal; a separate — NOT
// nested — download <a> overlays the top-end corner (we can't put an
// <a> inside a <button>). Download points at the same-origin proxy
// route (/api/library/images/[id]) which streams the file with
// `Content-Disposition: attachment` — a plain cross-origin public link
// would open inline instead of saving. The thumbnail crops to
// aspect-video; expand + download always show the full original.

// Wire shape for one library image. Co-located here (the leaf of the
// /library import graph: card ← client ← page) so both the client and
// the server page can import it without a circular dependency.
export type LibraryImage = {
  id: string;
  // Permanent public storage URL — used for the <img> preview only.
  // Downloads go through the proxy route (forces attachment + gates
  // ownership), not this URL directly.
  url: string;
  role: string; // hero | bg | accent
  projectId: string;
  projectTitle: string;
  createdAt: string; // ISO
};

// Thumbnails: the STATIC pre-generated `gen/thumb/*.webp` sibling (~30 KB,
// 700px long edge — see components/app/gen-thumb.tsx). Loading 15 full
// originals at once was ~37 MB against the browser's ~6-connection-per-host
// cap (tiles sat blank for seconds); the old fix was Supabase render/image
// transforms, replaced 2026-08 because they bill per distinct origin image
// per month. Download + expand keep the full original (image.url).

export function LibraryImageCard({
  image,
  onOpen,
}: {
  image: LibraryImage;
  onOpen: (image: LibraryImage) => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const roleLabels: Record<string, string> = {
    hero: dict.dialogs.libraryImage.hero,
    bg: dict.dialogs.libraryImage.background,
    accent: dict.dialogs.libraryImage.accent,
  };
  const roleLabel = roleLabels[image.role] ?? image.role;
  // Static thumb + escalation ladder (thumb → cache-bust → full original →
  // calm placeholder) — shared with the stock gallery, see gen-thumb.tsx.
  const { src, key, broken, onError } = useThumbSrc(image.url);
  return (
    <div className="group tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]">
      {/* Image surface — a button that opens the expand modal. */}
      <button
        type="button"
        onClick={() => onOpen(image)}
        aria-label={dict.dialogs.libraryImage.expand
          .replace("{role}", roleLabel)
          .replace("{title}", image.projectTitle)}
        className="absolute inset-0 block h-full w-full"
      >
        {/* Native <img> — Supabase storage URLs aren't in next
            remotePatterns (same call as ProjectThumbnail / TemplateTile).
            onError retries with a cache-bust then falls back, so a
            transient load failure self-heals instead of leaving a blank
            tile. `key={attempt}` remounts the img each retry so onError
            re-fires and the new src actually re-requests. */}
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
            alt={`${roleLabel} — ${image.projectTitle}`}
            // EAGER, not lazy. The grid is paginated to 15 tiles, so they're
            // a small bounded set that's essentially all in/near the
            // viewport — lazy-loading deferred the below-the-fold (bottom-
            // row) tiles, which then flashed empty on refresh until they
            // caught up. Eager fetches them immediately so the page paints
            // complete. The browser still caps concurrency (~6/host) + the
            // onError retry above covers any transient drop.
            loading="eager"
            decoding="async"
            draggable={false}
            // cover: fill the fixed 16:9 tile edge-to-edge. Most library
            // images are portrait (9:16 slide backgrounds), so this crops
            // them to the tile — the deliberate choice (over contain's side-
            // bars) so the grid reads as a clean, fully-filled set.
            className="h-full w-full object-cover"
            onError={onError}
          />
        )}
      </button>

      {/* Hover / keyboard-focus overlay: download button (top-end) +
          project label (bottom). Gradient + button bg use the shared
          `--tq-bg-dim` dark-scrim token so the chrome stays legible over
          any image without hardcoding a colour. pointer-events-none so
          it never blocks the expand click beneath; the download <a> opts
          back in. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          background:
            "linear-gradient(to top, var(--tq-bg-dim), transparent 55%)",
        }}
      >
        <div className="flex justify-end">
          <a
            href={`/api/library/images/${image.id}`}
            download
            aria-label={dict.dialogs.libraryImage.download
              .replace("{role}", roleLabel)
              .replace("{title}", image.projectTitle)}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-foreground transition-colors hover:text-foreground"
          >
            <span className="material-symbols-outlined text-[18px]">
              download
            </span>
          </a>
        </div>
        <p
          dir={dir}
          className="min-w-0 truncate text-[11px] font-semibold text-foreground"
        >
          {image.projectTitle}
        </p>
      </div>
    </div>
  );
}
