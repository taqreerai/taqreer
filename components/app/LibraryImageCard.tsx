"use client";

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

const ROLE_LABEL: Record<string, string> = {
  hero: "صورة رئيسية",
  bg: "خلفية",
  accent: "عنصر",
};

export function LibraryImageCard({
  image,
  onOpen,
}: {
  image: LibraryImage;
  onOpen: (image: LibraryImage) => void;
}) {
  const roleLabel = ROLE_LABEL[image.role] ?? image.role;
  return (
    <div className="group tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]">
      {/* Image surface — a button that opens the expand modal. */}
      <button
        type="button"
        onClick={() => onOpen(image)}
        aria-label={`توسيع ${roleLabel} من ${image.projectTitle}`}
        className="absolute inset-0 block h-full w-full"
      >
        {/* Native <img> — Supabase storage URLs aren't in next
            remotePatterns (same call as ProjectThumbnail / TemplateTile). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={`${roleLabel} — ${image.projectTitle}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
        />
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
            aria-label={`تحميل ${roleLabel} من ${image.projectTitle}`}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--tq-bg-dim)] text-white transition-colors hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">
              download
            </span>
          </a>
        </div>
        <p
          dir="rtl"
          className="min-w-0 truncate text-[11px] font-semibold text-white"
        >
          {image.projectTitle}
        </p>
      </div>
    </div>
  );
}
