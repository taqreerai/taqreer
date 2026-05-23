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

import { useEffect, useMemo, useState } from "react";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { SlidePresenceStack } from "@/components/preview/SlidePresenceStack";
import type { SlideManifest, SlideType } from "@/lib/schema/slide";
import { dimensionsForFormat, type SlideFormat } from "@/lib/schema/slide";
import type { PresenceViewer } from "@/lib/realtime/project-channel";

export const SLIDE_NAV_WIDTH = 320;

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
  // Phase 16.B presence — viewers currently focused on each slide
  // (already filtered to NOT-self by the caller). Map slideIndex →
  // array, empty / missing index means no avatars rendered for
  // that thumbnail. Optional so consumers that haven't wired
  // realtime yet keep working.
  viewersBySlide,
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
  viewersBySlide?: Record<number, PresenceViewer[]>;
}) {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(format);
  const aspectRatio = `${canvasW} / ${canvasH}`;

  // Guard against the on-refresh slide-in animation. The parent
  // (DeckView) hydrates `mainSidebarWidth` from localStorage in an
  // effect — the first paint uses the SSR default (260), the second
  // paint may flip to 80 if the user has the main sidebar collapsed.
  // With `transition-[right]` enabled on first paint, that 260 → 80
  // flip animates ("the sidebar detaches and slides ltr on refresh").
  // We delay enabling the transition by a couple of frames so the
  // initial value settles BEFORE the transition is wired up — only
  // subsequent (user-driven) toggles of the main sidebar animate.
  const [enableRightTransition, setEnableRightTransition] = useState(false);
  useEffect(() => {
    // Two rAFs: first lets React flush the post-mount commit, second
    // lets the browser paint with that committed `right` value. After
    // both, flipping the transition on is safe because there's no
    // pending value change to animate to.
    let inner: number | null = null;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEnableRightTransition(true);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== null) cancelAnimationFrame(inner);
    };
  }, []);
  // Thumbnail geometry — every value here mirrors a class on the
  // markup below so the math stays in lockstep with the rendered
  // layout. If you change one of those classes (`p-3`, `gap-3`,
  // `border-l`, `m-0.5` on the grid), update the matching constant.
  //
  //   ASIDE_PADDING_PX   = 12 (aside has `p-3`, applied both sides)
  //   ASIDE_BORDER_PX    = 1  (aside has `border-l`, 1 px ring on the
  //                            inline-start of the box)
  //   GRID_GAP_PX        = 16 (grid has `gap-4`, single horizontal gap
  //                            between the two columns)
  //   GRID_MARGIN_PX     = 2  (grid has `m-0.5`, 2 px each side — see
  //                            comment on the <div> below for why)
  //
  // Total horizontal chrome = 2*PAD + BORDER + GAP + 2*GRID_MARGIN
  //                         = 24 + 1 + 16 + 4 = 45
  // Per-cell width          = (260 − 45) / 2 = 107.5 px
  //
  // Earlier iterations missed the BORDER (`thumbW=112`) then missed the
  // GRID_MARGIN (`thumbW=111.5`). Both left a sub-pixel overflow on
  // the inline-end of each button that the button's `overflow-hidden`
  // ate as edge-stroke trim — the visual symptom the user kept flagging.
  const ASIDE_PADDING_PX = 12;
  const ASIDE_BORDER_PX = 1;
  const GRID_GAP_PX = 16;
  const GRID_MARGIN_PX = 2;
  const thumbW =
    (SLIDE_NAV_WIDTH -
      2 * ASIDE_PADDING_PX -
      ASIDE_BORDER_PX -
      GRID_GAP_PX -
      2 * GRID_MARGIN_PX) /
    2;
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
      // Glass surface — built from primitives (no `.glass-card`
      // because that class carries a hover transition we don't want
      // on a sidebar panel). Bg + border come from the canonical
      // design tokens `--tq-bg-glass` + `--tq-border-glass`
      // (globals.css) — same recipe `.glass-card` / `.qa-card` /
      // `.glass-popover` consume. Position values stay inline
      // because they're runtime-dynamic (`mainSidebarWidth` toggles
      // with the user's sidebar-collapsed cookie).
      //
      // `border-l` (physical left) is correct for the RTL/LTR pair:
      // in RTL the panel is on the visual right with its left edge
      // pointed at the canvas; in LTR the panel is still on the
      // physical right (positioned via `right: mainSidebarWidth`)
      // and its left edge still faces the canvas. Logical
      // `border-inline-start` would flip.
      className={`backdrop-blur-glass fixed top-20 bottom-0 z-[30] flex flex-col overflow-hidden border-l p-3 ease-in-out ${
        enableRightTransition ? "transition-[right] duration-300" : ""
      }`}
      style={{
        right: mainSidebarWidth,
        width: SLIDE_NAV_WIDTH,
        background: "var(--tq-bg-glass)",
        borderLeftColor: "var(--tq-border-glass)",
      }}
    >
      {(() => {
        // Localize the slide-count label by deck language. Both headers
        // used to hardcode their own string — title-present said "SLIDES"
        // in English regardless, no-title said "شرائح" in Arabic
        // regardless. Now both follow the `language` prop so the chrome
        // matches the deck's content language. `dir="auto"` lets the
        // browser anchor the digit-vs-word order naturally.
        const isSingle = items.length === 1;
        const countLabel =
          language === "en"
            ? `${items.length} ${isSingle ? "slide" : "slides"}`
            : `${items.length} ${isSingle ? "شريحة" : "شرائح"}`;
        return title ? (
          <header className="border-b border-white/[0.08] pb-3 px-1 pt-1">
            <p
              dir="auto"
              className="text-muted text-[10px] tracking-widest uppercase"
            >
              {countLabel}
            </p>
            <h1 className="mt-1 truncate text-sm font-semibold text-white">
              {title}
            </h1>
          </header>
        ) : (
          <header className="flex items-center justify-between px-1 pt-1 pb-3 border-b border-white/[0.08]">
            <span
              dir="auto"
              className="text-xs font-semibold text-white/50"
            >
              {countLabel}
            </span>
          </header>
        );
      })()}
      {/* Scrollable middle — `flex-1` so it absorbs vertical slack
          between header and footer; `overflow-y-auto` so the slide
          grid scrolls independently of the chrome. */}
      <div className="flex-1 overflow-y-auto pt-3">
        {/* `m-0.5` (= 2 px each side, via Tailwind's `--spacing`)
            inset the grid 2 px inside the aside's content-box so the
            buttons aren't flush against the aside's `overflow:hidden`
            clip boundary. Without this inset, edge-stroke rendering
            within each thumbnail's scaled SlideRenderer landed at
            sub-pixel positions right against the clip, aliasing the
            outermost strokes to invisibility. The matching
            GRID_MARGIN_PX constant in the thumbW math above keeps
            the SlideRenderer width == cell width (= 109.5 px) so the
            inset doesn't reintroduce an overflow on the inline-end. */}
        <div className="grid grid-cols-2 gap-4 m-0.5">
        {items.map((item) => {
          const isActive = currentIndex === item.index;
          // Active ring: 2 px neon-magenta (`--tq-magenta-hot` =
          // #F900FF), fully opaque. Brighter + thicker than the
          // previous 1 px brand-purple — the violet was reading too
          // quiet against the glass panel; the hot-magenta pops out
          // at thumbnail scale and matches the user's preferred
          // "this is selected" accent.
          const ringStyle = isActive
            ? {
                boxShadow: "0 0 0 2px var(--tq-magenta-hot)",
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
              // Only the active thumbnail carries a visible stroke now
              // (1 px white/60, via the inline `box-shadow` above).
              // Hover stroke + the muted idle ring were both removed
              // 2026-05-23 on user direction — the slide content does
              // the heavy lifting visually; chrome strokes on every
              // thumbnail read as a busy grid of frames against the
              // glass panel.
              //
              // `focus-visible` is intentionally kept (and slightly
              // brighter at `white/80`) so keyboard users still get a
              // clear tab-focus indicator — that's an a11y requirement,
              // not a hover decoration.
              className="relative w-full overflow-hidden text-start outline-none transition-all focus-visible:ring-1 focus-visible:ring-white/80"
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

              {/* Presence avatars — viewers currently focused on
                  this slide. Mounted at logical top-start (RTL: top-
                  right corner, LTR: top-left). Caller filters out
                  self; the stack itself caps at 2 visible + a "+N"
                  glass chip. `pointer-events: none` so the avatars
                  never block the thumbnail click. */}
              {viewersBySlide && viewersBySlide[item.index]?.length ? (
                <SlidePresenceStack viewers={viewersBySlide[item.index]} />
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
