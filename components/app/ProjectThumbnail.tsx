"use client";

// Project tile — used by the dashboard RecentProjects widget and
// (later) /projects page.
//
// Layout: full-bleed 16:9 thumbnail surface on top; a flat info row
// underneath carrying the title + creation date + 3-dots actions
// trigger. No hover effects on the thumbnail (no dim, no overlay,
// no fade-in chrome). Everything below the thumbnail is always
// visible.
//
// THREE behaviours on the thumbnail surface:
//
//   1. ASPECT — always 16:9 so the grid stays uniform. 9:16
//      source thumbnails use `object-cover object-top` to show
//      the slide's top portion cropped to landscape. 16:9 decks
//      fit naturally with no crop.
//
//   2. SCRUB — once the cursor has moved past SCRUB_ACTIVATION_PX
//      from its entry position, the X position maps linearly to
//      a slide index. RTL direction: rightmost = slide 1,
//      leftmost = slide N. The first mousemove just records the
//      entry X; bare hover doesn't trigger scrub. Cursor leaves →
//      snap back to slide 0. A small counter chip shows at the
//      thumbnail's bottom-end while scrubbing.
//
//   3. CLICK — opens the lightbox via the parent's onOpen callback.
//
// FOOTER (always visible, below the thumbnail):
//   • Title + creation date (truncated, RTL-aligned to start side
//     = visual right in Arabic).
//   • 3-dots menu trigger on the end side (= visual LEFT in RTL).
//     Real button; stopPropagation isn't required because the
//     footer is OUTSIDE the thumbnail click surface.

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import type { SlideFormat } from "@/lib/schema/slide";

// Pixels of cursor travel required to consider the user actually
// scrubbing (not just hovering at rest). ~2 trackpad ticks.
const SCRUB_ACTIVATION_PX = 6;

type Props = {
  slides: string[];
  format: SlideFormat;
  title: string;
  createdAt: Date | string;
  // Click anywhere on the thumbnail surface opens the lightbox.
  // Parent owns lightbox state.
  onOpen: () => void;
  // Click on the 3-dots button — passes the trigger's DOMRect so
  // the parent can anchor a menu under it.
  onOpenMenu?: (triggerRect: DOMRect | null) => void;
};

export function ProjectThumbnail({
  slides,
  format,
  title,
  createdAt,
  onOpen,
  onOpenMenu,
}: Props) {
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const entryXRef = useRef<number | null>(null);
  // Thumbnail-hover flag — flips title + 3-dots between muted /
  // white. Tracked in JS (not CSS group/peer) because the title
  // and dots live in a footer that's a sibling-of-sibling of the
  // thumbnail (Tailwind `peer-hover:` only walks one sibling
  // level). Easier to set state than to restructure DOM for a
  // CSS selector.
  const [thumbHovered, setThumbHovered] = useState(false);

  const displayIndex = hoverIndex ?? 0;
  const src = slides[displayIndex] ?? null;
  const hasSlides = slides.length > 0;
  const isMultiSlide = slides.length > 1;

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isMultiSlide) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (entryXRef.current == null) {
      entryXRef.current = e.clientX;
      return;
    }
    if (Math.abs(e.clientX - entryXRef.current) < SCRUB_ACTIVATION_PX) {
      return;
    }
    const relX = e.clientX - rect.left;
    // RTL mapping: rightmost pixel = slide 1, leftmost = slide N.
    const idx = Math.min(
      slides.length - 1,
      Math.max(0, Math.floor(((rect.width - relX) / rect.width) * slides.length)),
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    entryXRef.current = null;
  };

  const imgObjectClass =
    format === "9:16" ? "object-cover object-top" : "object-cover";

  const relativeDate = formatDistanceToNow(new Date(createdAt), {
    addSuffix: true,
    locale: ar,
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Thumbnail — clean, no hover dim, no overlay chrome.
          mouseenter/leave on the wrapper flip the thumbHovered
          flag → title + 3-dots transition between muted/white. */}
      <div
        className="tq-thumbnail relative aspect-video w-full overflow-hidden rounded-[14px]"
        onMouseEnter={() => setThumbHovered(true)}
        onMouseLeave={() => setThumbHovered(false)}
      >
        <button
          ref={rootRef}
          type="button"
          onClick={hasSlides ? onOpen : undefined}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          disabled={!hasSlides}
          aria-label={
            hasSlides
              ? `معاينة ${title} — ${slides.length} ${slides.length === 1 ? "شريحة" : "شرائح"}`
              : `${title} — لا توجد معاينة`
          }
          className={`absolute inset-0 block ${
            hasSlides ? "cursor-zoom-in" : "cursor-default"
          }`}
        >
          {src ? (
            <img
              alt=""
              aria-hidden
              src={src}
              className={`h-full w-full ${imgObjectClass}`}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-muted opacity-25">
                image
              </span>
            </span>
          )}
        </button>

        {/* Scrub counter — bottom-end (left in RTL). Only while
            scrubbing a multi-slide deck. Outside the click surface
            but inside the rounded thumbnail container. */}
        {isMultiSlide && hoverIndex !== null ? (
          <span
            dir="ltr"
            className="pointer-events-none absolute bottom-2 end-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
          >
            {hoverIndex + 1} / {slides.length}
          </span>
        ) : null}
      </div>

      {/* Info row — title + creation date on the start side (right
          in RTL), 3-dots menu trigger on the end side (left in RTL).
          Always visible, no hover gating. */}
      <div dir="rtl" className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          {/* Title + 3-dots color is driven by INLINE style (not
              Tailwind `text-white`/`text-muted` utilities) because
              the custom `.text-muted` rule in globals.css lives
              OUTSIDE Tailwind's `@layer utilities` and beats the
              layered `.text-white` rule even when only `text-white`
              is on the className — Tailwind v4's @layer cascade
              gives unlayered rules higher priority. Inline-style
              sidesteps the entire layer fight. */}
          <p
            className="truncate text-xs font-semibold leading-tight transition-colors"
            style={{
              color: thumbHovered
                ? "var(--tq-text-primary)"
                : "var(--tq-text-muted)",
            }}
            title={title}
          >
            {title}
          </p>
          <p className="mt-0.5 text-[10px] text-muted">{relativeDate}</p>
        </div>
        <button
          ref={menuBtnRef}
          type="button"
          aria-label="خيارات المشروع"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu?.(
              menuBtnRef.current?.getBoundingClientRect() ?? null,
            );
          }}
          className="btn-icon -mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors"
          style={{
            color: thumbHovered
              ? "var(--tq-text-primary)"
              : "var(--tq-text-muted)",
          }}
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      </div>
    </div>
  );
}
