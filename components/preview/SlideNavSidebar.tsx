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
//
// LAYOUT (top → bottom):
//   • header (deck title + slide count)
//   • scrollable slide grid (the thumbnails)
//   • footer (Lock all / Unlock all pill, sticky to the bottom)
// The header + footer are flex children; the middle grid scrolls
// independently via `flex-1 overflow-y-auto`.

import { useMemo, useState } from "react";
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
      // True when the slide's SlideState.lockedAt is set — the
      // thumbnail dims and a centered lock icon overlays the slide
      // (user feedback 2026-05-20: a small corner icon was too easy
      // to miss when scanning a 15-slide deck for locked rows).
      locked?: boolean;
    };

export function SlideNavSidebar({
  items,
  currentIndex,
  onSelect,
  manifest,
  format,
  title,
  mainSidebarWidth,
  // User-picked content language (from manifest.language when
  // available, else the brief). Drives the panel's reading direction
  // — English-only decks should NOT show the slide grid right-to-left
  // (the visual #1 ended up on the right, which read wrong for LTR
  // content). Optional + defaults to "ar" so callers that haven't
  // wired the prop yet keep the historical RTL behavior.
  language = "ar",
  // Locked / unlocked counts so the bulk-toggle pill can read the
  // global state. The parent already computes per-slide `locked` on
  // each NavItem; we could derive these from `items` directly, but
  // taking them as props lets the parent share the canonical
  // `slideStates` source of truth across all UI that reads it.
  onLockAll,
  onUnlockAll,
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
  language?: "ar" | "en";
  // Fires when the user clicks the bulk pill. Parent owns the
  // network call + optimistic state update so it can fan the result
  // out across every dependent UI (sidebar locked badges, hero
  // pill icon, regen-button gating). Omit both to hide the pill —
  // e.g. during generation, when no SlideState rows exist yet.
  onLockAll?: () => void | Promise<void>;
  onUnlockAll?: () => void | Promise<void>;
}) {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(format);
  const aspectRatio = `${canvasW} / ${canvasH}`;
  // (260 outer − 24 horizontal padding − 12 col gap) / 2 cols ≈ 112 px
  // per thumbnail. Scale = thumbW / canvasW so the SlideRenderer fits.
  const thumbW = (SLIDE_NAV_WIDTH - 24 - 12) / 2;
  const thumbScale = thumbW / canvasW;

  // Derive bulk-lock state from items so the pill's label flips
  // reactively: "Lock all" when at least one slide is unlocked,
  // "Unlock all" when every slide is locked. Placeholders during
  // generation don't count (they have no SlideState yet); if the
  // deck has no slide-kind items, the pill stays hidden.
  const { slideCount, allLocked, anyUnlocked } = useMemo(() => {
    let total = 0;
    let locked = 0;
    for (const it of items) {
      if (it.kind === "slide") {
        total += 1;
        if (it.locked) locked += 1;
      }
    }
    return {
      slideCount: total,
      allLocked: total > 0 && locked === total,
      anyUnlocked: total > 0 && locked < total,
    };
  }, [items]);
  // Pill is in-flight while the bulk request is round-tripping —
  // disables further clicks (the optimistic flip already updated
  // `items`, so a second click would race against the server's
  // pending response).
  const [bulkBusy, setBulkBusy] = useState(false);
  const showBulkPill =
    slideCount > 0 && (onLockAll != null || onUnlockAll != null);

  const handleBulkClick = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      if (allLocked) {
        await onUnlockAll?.();
      } else if (anyUnlocked) {
        await onLockAll?.();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const panelDir: "rtl" | "ltr" = language === "en" ? "ltr" : "rtl";

  return (
    <aside
      dir={panelDir}
      aria-label="شريط الشرائح"
      // Glass surface — built from primitives (no `.glass-card` because
      // that class carries a hover transition we don't want on a sidebar
      // panel). The `backdrop-blur-glass` utility is the preset-linked
      // blur token; the inline bg / border-color use the same CSS
      // variables `.glass-card` reads. Identical to CommentsPanel so
      // the two read as a mirrored pair around the hero canvas.
      //
      // `border-l` (physical left) is correct for the RTL/LTR pair:
      // in RTL the panel is on the visual right with its left edge
      // pointed at the canvas; in LTR the panel is still on the
      // physical right (positioned via `right: mainSidebarWidth`)
      // and its left edge still faces the canvas. Logical
      // `border-inline-start` would flip.
      className="backdrop-blur-glass fixed z-[30] flex flex-col overflow-hidden border-l p-3 transition-[right] duration-300 ease-in-out"
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
        <header className="flex items-center justify-between px-1 pt-1 pb-3 border-b border-white/[0.08]">
          <span className="text-xs font-semibold text-white/50">
            {items.length} {items.length === 1 ? "شريحة" : "شرائح"}
          </span>
        </header>
      )}
      {/* Scrollable middle — `flex-1` so it absorbs vertical slack
          between header and footer; `overflow-y-auto` so the slide
          grid scrolls independently of the chrome. */}
      <div className="flex-1 overflow-y-auto pt-3">
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
          const isLocked = item.kind === "slide" && item.locked === true;
          return (
            <button
              key={item.index}
              type="button"
              onClick={() => onSelect(item.index)}
              aria-label={`الشريحة ${item.index + 1}${
                isActive ? " — مختارة" : ""
              }${isLocked ? " — مقفلة" : ""}`}
              aria-current={isActive ? "true" : undefined}
              className={`relative w-full overflow-hidden rounded-md text-start outline-none transition-all hover:ring-2 hover:ring-white/40 focus-visible:ring-2 focus-visible:ring-white/80 ${
                isActive ? "" : "ring-1 ring-white/10"
              }`}
              style={{ aspectRatio, ...ringStyle }}
            >
              {/* Thumbnail content — placeholder pulse + state icon, or
                  a SlideRenderer at thumbnail scale. Locked thumbnails
                  fade the content to ~45 % so the centred lock icon
                  reads as the dominant signal. */}
              <div
                className={`h-full w-full transition-opacity ${
                  isLocked ? "opacity-45" : ""
                }`}
              >
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
              </div>

              {/* Regenerating overlay — when applying drafts for
                  this slide, dim the thumbnail and show a spinner.
                  Same affordance as the hero's in-flight overlay. */}
              {item.kind === "slide" && item.regenerating ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
                  <span className="spinner h-5 w-5 rounded-full border-2 border-white/30 border-t-white" />
                </div>
              ) : null}

              {/* Locked overlay — centred padlock icon on a faintly
                  tinted backdrop. Replaces the old top-left corner
                  badge so the locked state is unmissable at a glance
                  (user feedback 2026-05-20). The opacity dim on the
                  thumbnail content above + this overlay together
                  give the slide a "frozen" look. */}
              {isLocked ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
                  <span
                    className="material-symbols-outlined text-white drop-shadow-lg"
                    style={{ fontSize: 28 }}
                    aria-hidden
                  >
                    lock
                  </span>
                </div>
              ) : null}

              {/* Comment-count badge — physical TOP-RIGHT corner
                  regardless of slide direction (RTL or LTR). Fixed
                  4×4 (16 px) square so single-digit counts render
                  as a perfect circle; two-digit counts widen via
                  `min-w-4` instead of stretching the height. */}
              {item.kind === "slide" && item.commentCount > 0 ? (
                <div className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
                  {item.commentCount}
                </div>
              ) : null}

              {/* Slide number — physical BOTTOM-RIGHT chip. Same
                  visual recipe as the project-thumbnail scrub
                  counter (bg-black/70 + 10 px). Dir=ltr so digits
                  read "01 / 02 / …" regardless of the panel's
                  reading direction; `tabular-nums` keeps the chip
                  width stable as the number grows from 1 → 12. */}
              <span
                dir="ltr"
                className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-white"
              >
                {String(item.index + 1).padStart(2, "0")}
              </span>
            </button>
          );
        })}
        </div>
      </div>

      {/* Footer — Lock all / Unlock all bulk pill. Label flips
          based on the global locked state across the deck. Hidden
          during generation (placeholders don't have lock state)
          and when the parent didn't wire either handler. */}
      {showBulkPill ? (
        <footer className="border-t border-white/[0.08] pt-3 px-1">
          <button
            type="button"
            onClick={handleBulkClick}
            disabled={bulkBusy}
            className="btn-pill w-full justify-center"
          >
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 16 }}
              aria-hidden
            >
              {allLocked ? "lock_open" : "lock"}
            </span>
            {bulkBusy
              ? "..."
              : allLocked
                ? "إلغاء قفل الكل"
                : "قفل الكل"}
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
