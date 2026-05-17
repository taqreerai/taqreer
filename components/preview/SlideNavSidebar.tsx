"use client";

// Slide navigator — fixed glass panel docked against the main app
// sidebar's inner edge. Always visible (during generation AND after).
// Drives `currentSlideIndex` in DeckView via clicks. During generation
// each tile is a placeholder with a state (pending / current / done);
// after completion each tile renders the actual slide via SlideRenderer
// at thumbnail scale.
//
// Width matches the expanded main sidebar (260 px) so the two read as
// one panel on the right edge. `transition-[right]` mirrors the main
// sidebar's slide animation so the two move in lockstep when the user
// toggles the main sidebar.

import { SlideRenderer } from "@/components/slides/SlideRenderer";
import type { SlideManifest, SlideType } from "@/lib/schema/slide";
import { dimensionsForFormat, type SlideFormat } from "@/lib/schema/slide";

export const SLIDE_NAV_WIDTH = 260;

type PlaceholderState = "done" | "current" | "pending";

export type NavItem =
  | { kind: "placeholder"; index: number; state: PlaceholderState }
  | {
      kind: "slide";
      index: number;
      slide: SlideType;
      commentCount: number;
      // True while a partial regen targeting this slide is in flight.
      // Dims the thumbnail + shows a spinner overlay so the user sees
      // which slides are being rewritten.
      regenerating?: boolean;
    };

export function SlideNavSidebar({
  items,
  currentIndex,
  onSelect,
  manifest,
  format,
  title,
  mainSidebarWidth,
}: {
  items: NavItem[];
  currentIndex: number | null;
  onSelect: (idx: number) => void;
  // Theme only — for the thumbnail SlideRenderer. Null during early
  // streaming (no manifest yet); placeholder tiles don't need it.
  manifest: SlideManifest | null;
  format: SlideFormat;
  // Optional deck title to render at the top of the nav. Replaces the
  // old centered header above the slide grid. Truncates with ellipsis.
  title?: string | null;
  // Width of the main app sidebar (80 collapsed, 260 expanded). The
  // slide-nav docks against the main sidebar's inner edge — visual
  // contract: the two panels feel like one.
  mainSidebarWidth: number;
}) {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(format);
  const aspectRatio = `${canvasW} / ${canvasH}`;
  // (260 outer − 24 horizontal padding − 12 col gap) / 2 cols ≈ 112 px
  // per thumbnail. Scale = thumbW / canvasW so the SlideRenderer fits.
  const thumbW = (SLIDE_NAV_WIDTH - 24 - 12) / 2;
  const thumbScale = thumbW / canvasW;

  return (
    <aside
      dir="rtl"
      aria-label="شريط الشرائح"
      // Glass surface — built from primitives (no `.glass-card` because
      // that class carries a hover transition we don't want on a sidebar
      // panel). The `backdrop-blur-glass` utility is the preset-linked
      // blur token; the inline bg / border-color use the same CSS
      // variables `.glass-card` reads. Identical to CommentsPanel so
      // the two read as a mirrored pair around the hero canvas.
      className="backdrop-blur-glass fixed z-[30] flex flex-col gap-3 overflow-y-auto border-l p-3 transition-[right] duration-300 ease-in-out"
      style={{
        top: 80, // Header height (h-20)
        bottom: 0,
        right: mainSidebarWidth,
        width: SLIDE_NAV_WIDTH,
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderLeftColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      {title ? (
        <header className="border-b border-white/[0.08] pb-3 px-1 pt-1">
          <p className="text-muted text-[10px] tracking-widest">
            {items.length} SLIDES
          </p>
          <h1 className="mt-1 truncate text-sm font-semibold text-white">
            {title}
          </h1>
        </header>
      ) : (
        <header className="flex items-center justify-between px-1 pt-1">
          <span className="text-xs font-semibold text-white/50">
            {items.length} {items.length === 1 ? "شريحة" : "شرائح"}
          </span>
        </header>
      )}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const isActive = currentIndex === item.index;
          // Active ring: solid brand-blue inner + 25 % alpha halo.
          // Both layers reference design tokens (no hardcoded hex);
          // the alpha layer uses --tq-blue-rgb so the alpha factor
          // can change without re-deriving the brand colour.
          const ringStyle = isActive
            ? {
                boxShadow:
                  "0 0 0 2px var(--tq-blue), 0 0 0 4px rgba(var(--tq-blue-rgb), 0.25)",
              }
            : undefined;
          return (
            <button
              key={item.index}
              type="button"
              onClick={() => onSelect(item.index)}
              aria-label={`الشريحة ${item.index + 1}${
                isActive ? " — مختارة" : ""
              }`}
              aria-current={isActive ? "true" : undefined}
              className={`relative w-full overflow-hidden rounded-md text-start outline-none transition-all hover:ring-2 hover:ring-white/40 focus-visible:ring-2 focus-visible:ring-white/80 ${
                isActive ? "" : "ring-1 ring-white/10"
              }`}
              style={{ aspectRatio, ...ringStyle }}
            >
              {/* Thumbnail content — placeholder pulse + state icon, or
                  a SlideRenderer at thumbnail scale. */}
              {item.kind === "placeholder" ? (
                <div
                  className={`flex h-full w-full items-center justify-center bg-white/5 ${
                    item.state === "pending" || item.state === "current"
                      ? "animate-pulse"
                      : ""
                  }`}
                >
                  {item.state === "done" ? (
                    <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: "32px" }}>
                      check_circle
                    </span>
                  ) : item.state === "current" ? (
                    <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
                  ) : null}
                </div>
              ) : manifest ? (
                <div className="h-full w-full" style={{ background: manifest.theme.background }}>
                  <SlideRenderer
                    slide={item.slide}
                    theme={manifest.theme}
                    direction={manifest.direction}
                    language={manifest.language}
                    width={canvasW}
                    height={canvasH}
                    scale={thumbScale}
                  />
                </div>
              ) : null}

              {/* Regenerating overlay — when applying drafts for
                  this slide, dim the thumbnail and show a spinner.
                  Same affordance as the hero's in-flight overlay. */}
              {item.kind === "slide" && item.regenerating ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
                  <span className="spinner h-5 w-5 rounded-full border-2 border-white/30 border-t-white" />
                </div>
              ) : null}

              {/* Comment-count badge — visual TOP-RIGHT corner
                  regardless of slide direction (RTL or LTR). Fixed
                  4×4 (16 px) square so single-digit counts render
                  as a perfect circle; two-digit counts widen via
                  `min-w-4` instead of stretching the height. */}
              {item.kind === "slide" && item.commentCount > 0 ? (
                <div className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
                  {item.commentCount}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
