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

import { useEffect, useState, type ReactNode } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { SegmentedToggle } from "@/components/create/controls";
import { SlideRenderer, slideRootBackground } from "@/components/slides/SlideRenderer";
import { SlidePresenceStack } from "@/components/preview/SlidePresenceStack";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import type { SlideManifest, SlideType } from "@/lib/schema/slide";
import { dimensionsForFormat, type SlideFormat } from "@/lib/schema/slide";
import type { PresenceViewer } from "@/lib/realtime/project-channel";
import { BrandedClosingSlide } from "@/components/preview/FreeBranding";
import type { BrandLang, SlideDims } from "@/lib/export/free-branding";

// Studio: the Slides nav + Layers panel share this width (so the slide centers
// symmetrically between them). 280 — the nav's thumbnails size to this width.
export const SLIDE_NAV_WIDTH = 280;

// Studio: both floating rails anchor to this fixed page band (NOT the canvas top,
// which is vertically centered and pushed the rails low). `top: RAIL_TOP` +
// `bottom: RAIL_BOTTOM` gives both rails the SAME height, spanning the usable
// page below the header strip and above the bottom action bar.
export const RAIL_TOP = 72; // clears the fixed header strip (~48px) + air
export const RAIL_BOTTOM = 96; // clears the bottom action bar

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
      // True while the deck is still GENERATING: a streamed slide is a
      // first draft the model may still swap via a data-revises
      // correction (or the freeze bake's self-fix). The tile shows a
      // "draft" chip so nobody treats it as final; the chip vanishes
      // for the whole deck the moment the completed manifest takes
      // over the nav items.
      draft?: boolean;
    }
  // Teaser paywall (free-tier): a WITHHELD slide shown locked. Never a real
  // manifest slide - `index` continues past the real slides (so the number chip
  // reads 06, 07, ...) but selection routes through `onTeaserSelect(lockedIndex)`,
  // not `onSelect`. `gradient` is a CSS background built from the deck palette
  // (random per slot), rendered under the padlock overlay.
  | {
      kind: "teaser";
      index: number;
      lockedIndex: number;
      gradient: string;
    }
  // Free-plan branded closing slide (2026-10-02): a system tile after the
  // real slides. Never a manifest slide; selection routes through
  // `onBrandSelect`, and it can't be edited or removed.
  | {
      kind: "brand";
      index: number;
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
  onCancelGeneration,
  cancelDisabled = false,
  // Phase 16.B presence — viewers currently focused on each slide
  // (already filtered to NOT-self by the caller). Map slideIndex →
  // array, empty / missing index means no avatars rendered for
  // that thumbnail. Optional so consumers that haven't wired
  // realtime yet keep working.
  viewersBySlide,
  // Studio mode — float as a rounded glass card inset from the viewport edges
  // (no longer docked against the now-absent main sidebar).
  floating = false,
  // Slides ⇄ Comments tab (§16). `commentsSlot` is the embedded CommentsPanel
  // rendered in the Comments tab; when omitted, only the Slides grid shows and
  // no tab bar appears. `tab` defaults to "slides" so unwired callers (the
  // /create + /enhance live previews) are unchanged.
  tab = "slides",
  onTabChange,
  commentsSlot,
  commentCount,
  // §22: document actions (Export ▾ + Share) relocated from the removed
  // StudioHeader into the slide-nav footer. The parent (DeckView) builds them
  // (it owns the manifest + ShareDialog) and passes them as a slot.
  actionsSlot,
  // Studio: collapsed → the card slides off the inline edge (kept mounted so the
  // thumbnails never remount/flash) and DeckView shows a bare edge arrow.
  collapsed = false,
  // Teaser paywall: which locked slot (0-based) is currently focused, so its
  // tile carries the active ring; null when a real slide is focused. Selecting
  // a teaser tile routes here instead of onSelect.
  currentTeaser = null,
  onTeaserSelect,
  brandActive = false,
  onBrandSelect,
  brandLang = "ar",
  brandDims,
  // Teaser paywall (free tier). When `teaserLocked`, the footer shows an accent
  // "Unlock the remaining slides" CTA, wired to the parent's upgrade→unlock
  // flow via `onTeaserUnlock`.
  teaserLocked = false,
  onTeaserUnlock,
  teaserUnlockBusy = false,
}: {
  items: NavItem[];
  currentIndex: number | null;
  onSelect: (idx: number) => void;
  currentTeaser?: number | null;
  onTeaserSelect?: (lockedIndex: number) => void;
  brandActive?: boolean;
  onBrandSelect?: () => void;
  brandLang?: BrandLang;
  brandDims?: SlideDims;
  teaserLocked?: boolean;
  onTeaserUnlock?: () => void;
  teaserUnlockBusy?: boolean;
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
  floating?: boolean;
  // Slides ⇄ Comments tab (§16). Active tab + change handler; `commentsSlot`
  // is the embedded CommentsPanel body; `commentCount` badges the tab.
  tab?: "slides" | "comments";
  onTabChange?: (tab: "slides" | "comments") => void;
  commentsSlot?: ReactNode;
  commentCount?: number;
  actionsSlot?: ReactNode;
  collapsed?: boolean;
  language?: "ar" | "en";
  viewersBySlide?: Record<number, PresenceViewer[]>;
  // Cancel pill — shown at the bottom of the sidebar during the
  // generating phase only. Caller (DeckView) handles the
  // confirmation modal + POST to /api/projects/[id]/cancel; we just
  // surface the trigger. Omit to hide the pill (e.g. on completed
  // decks where there's nothing to cancel).
  onCancelGeneration?: () => void;
  // Disable the pill during the cancel request's in-flight window
  // (between user click + server ack) so they can't double-fire.
  cancelDisabled?: boolean;
}) {
  const dict = useDict();
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
  // Flush rail has `border-l` (1px, inline-start only); the floating Studio card
  // has a full `border` (both inline edges), so its horizontal chrome is 2px.
  const ASIDE_BORDER_PX = floating ? 2 : 1;
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

  // Free-tier paywall CTA in the footer. The bulk "lock/unlock all" regen pill
  // that used to live here was removed (2026-07-24): it confused free users
  // (read as "unlock the gated slides") and duplicated the per-slide lock in
  // the AI bar. Slide-level regen protection is now per-slide only, in AI mode.
  const showTeaserUnlock = teaserLocked && onTeaserUnlock != null;

  // The rail's reading direction follows the DECK's content language, NOT the
  // UI locale: a fully-English deck viewed in an Arabic UI must still lay its
  // thumbnails out left-to-right (user direction 2026-07-23). The panel itself
  // always docks physically right (see the `right:`/`border-l` note below); this
  // only orders the thumbnail grid + header text.
  const panelDir: "rtl" | "ltr" = language === "en" ? "ltr" : "rtl";

  return (
    <aside
      // Collapsed → off-screen: take it out of the tab order + a11y tree too,
      // not just pointer events (CR), so hidden controls can't be focused.
      inert={collapsed}
      aria-hidden={collapsed || undefined}
      dir={panelDir}
      aria-label={dict.editor.nav.slidesSidebar}
      // Glass surface — built from primitives (no `.surface-card`
      // because that class carries a hover transition we don't want
      // on a sidebar panel). Bg + border come from the canonical
      // design tokens `--tq-surface` + `--tq-border-hairline`
      // (globals.css) — same recipe `.surface-card` / `.qa-card` /
      // `.surface-popover` consume. Position values stay inline
      // because they're runtime-dynamic (`mainSidebarWidth` toggles
      // with the user's sidebar-collapsed cookie).
      //
      // `border-l` (physical left) is correct for the RTL/LTR pair:
      // in RTL the panel is on the visual right with its left edge
      // pointed at the canvas; in LTR the panel is still on the
      // physical right (positioned via `right: mainSidebarWidth`)
      // and its left edge still faces the canvas. Logical
      // `border-inline-start` would flip.
      className={
        floating
          ? // Studio: a rounded glass card floating off the right edge, inset
            // from the top (clears the back pill) and bottom (clears the
            // bottom action bar). Full border + radius — not a flush rail.
            " fixed z-[30] flex flex-col overflow-hidden rounded-3xl border p-3"
          : ` fixed top-20 bottom-0 z-[30] flex flex-col overflow-hidden border-l p-3 ease-in-out ${
              enableRightTransition ? "transition-[right] duration-300" : ""
            }`
      }
      style={
        floating
          ? {
              // Anchored to the fixed page band [RAIL_TOP, vh - RAIL_BOTTOM] so
              // it's full-height + matches the Layers rail exactly, and stays
              // centered on the page regardless of where the canvas sits (user
              // direction 2026-06-14). 16px off the inline edge. Collapsed →
              // slide fully off the right edge (still mounted; DeckView shows a
              // bare edge arrow to reopen).
              right: 16,
              top: RAIL_TOP,
              bottom: RAIL_BOTTOM,
              transform: collapsed ? "translateX(calc(100% + 24px))" : undefined,
              width: SLIDE_NAV_WIDTH,
              background: "var(--tq-surface)",
              borderColor: "var(--tq-border-hairline)",
              pointerEvents: collapsed ? "none" : undefined,
              transition: "transform 300ms ease",
            }
          : {
              right: mainSidebarWidth,
              width: SLIDE_NAV_WIDTH,
              background: "var(--tq-surface)",
              borderLeftColor: "var(--tq-border-hairline)",
            }
      }
    >
      {(() => {
        // Localize the slide-count label by deck language. Both headers
        // used to hardcode their own string — title-present said "SLIDES"
        // in English regardless, no-title said "شرائح" in Arabic
        // regardless. Now both follow the `language` prop so the chrome
        // matches the deck's content language. `dir="auto"` lets the
        // browser anchor the digit-vs-word order naturally.
        const isSingle = items.length === 1;
        const countLabel = `${items.length} ${
          isSingle ? dict.editor.nav.slideOne : dict.editor.nav.slideMany
        }`;
        return title ? (
          <header className="border-b border-foreground/[0.08] pb-3 px-1 pt-1">
            <p
              dir="auto"
              className="text-muted text-[10px] tracking-widest uppercase"
            >
              {countLabel}
            </p>
            <h1 className="mt-1 truncate text-sm font-semibold text-foreground">
              {title}
            </h1>
          </header>
        ) : (
          <header className="flex items-center justify-between px-1 pt-1 pb-3 border-b border-foreground/[0.08]">
            <span
              dir="auto"
              className="text-xs font-semibold text-foreground/50"
            >
              {countLabel}
            </span>
          </header>
        );
      })()}
      {/* Slides ⇄ Comments tab — only when the parent wires a comments slot
          (the Studio editor for owner/edit/comment roles). */}
      {commentsSlot ? (
        <div className="px-1 pt-3">
          <SegmentedToggle
            options={[
              { value: "slides", label: dict.editor.nav.slidesTab, icon: "grid_view" },
              {
                value: "comments",
                label: commentCount
                  ? `${dict.editor.nav.commentsTab} ${commentCount}`
                  : dict.editor.nav.commentsTab,
                icon: "chat_bubble",
              },
            ]}
            value={tab}
            onChange={(t) => onTabChange?.(t)}
            ariaLabel={dict.editor.nav.showSlidesOrComments}
            size="comfortable"
            fullWidth
          />
        </div>
      ) : null}
      {/* Body — Comments tab = the embedded CommentsPanel; Slides tab (default)
          = the scrollable thumbnail grid (flex-1 + overflow-y-auto so it scrolls
          independently of the chrome). */}
      {commentsSlot && tab === "comments" ? (
        <div className="flex min-h-0 flex-1 flex-col pt-3">{commentsSlot}</div>
      ) : (
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
          const isTeaser = item.kind === "teaser";
          // Teaser tiles carry the active ring off `currentTeaser`; real tiles
          // off `currentIndex` (and never while a teaser is focused). Narrow on
          // item.kind inline so TS sees the teaser-only fields.
          const isActive =
            item.kind === "teaser"
              ? currentTeaser === item.lockedIndex
              : item.kind === "brand"
                ? brandActive
                : currentIndex === item.index && currentTeaser == null && !brandActive;
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
              onClick={() =>
                item.kind === "teaser"
                  ? onTeaserSelect?.(item.lockedIndex)
                  : item.kind === "brand"
                    ? onBrandSelect?.()
                    : onSelect(item.index)
              }
              aria-label={
                dict.editor.nav.slideAria.replace("{n}", String(item.index + 1)) +
                (isActive ? dict.editor.nav.slideSelected : "") +
                (isLocked || isTeaser || item.kind === "brand" ? dict.editor.nav.slideLocked : "")
              }
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
                    className={`flex h-full w-full items-center justify-center bg-foreground/5 ${
                      item.state === "pending" || item.state === "current"
                        ? "animate-pulse"
                        : ""
                    }`}
                  >
                    {item.state === "done" ? (
                      // White + smaller checkmark (was emerald-400 @ 32 px).
                      // Rationale 2026-05-25: the "done" state on a
                      // PLACEHOLDER card means "Claude advanced past this
                      // slide in his buffer" — NOT "this slide is designed
                      // and ready" (if it were, the slot would render a
                      // real slide thumbnail via the `kind:"slide"` branch
                      // above, not a placeholder). The green check was a
                      // misleading celebration; white at reduced opacity
                      // communicates "we processed this slot, no visual
                      // yet" — which is what's actually true. /create
                      // never sees this state because its slides stream
                      // fast enough to swap placeholders to real thumbnails
                      // before the user notices; /enhance is the visible
                      // case (PDF reading + thinking-phase iteration push
                      // text streaming to a tight burst at the end).
                      <span className="material-symbols-outlined text-foreground/60" style={{ fontSize: "18px" }}>
                        check_circle
                      </span>
                    ) : item.state === "current" ? (
                      // Paragraph-write icon — three lines that write
                      // themselves LTR (or RTL when the deck language
                      // is Arabic). Replaces the older spinner so the
                      // loading affordance reads as "Claude is writing
                      // this slide" instead of a generic wait.
                      <ParagraphWriteIcon
                        rtl={language === "ar"}
                        size={22}
                        className="text-foreground/70"
                      />
                    ) : null}
                  </div>
                ) : item.kind === "brand" ? (
                  // Branded closing slide thumbnail (static, not clickable
                  // inside - the tile button handles selection).
                  brandDims ? (
                    <div className="relative h-full w-full">
                      <BrandedClosingSlide lang={brandLang} dims={brandDims} interactive={false} />
                    </div>
                  ) : null
                ) : item.kind === "teaser" ? (
                  // Locked teaser tile: a palette gradient (no real content);
                  // the padlock overlay below marks it locked.
                  <div
                    className="h-full w-full"
                    style={{ background: item.gradient }}
                  />
                ) : manifest ? (
                  <div
                    className="h-full w-full"
                    // Match the SlideRenderer's own wrapper: the slide's resolved
                    // root bg, else TRANSPARENT (not the deck theme white) so a
                    // dark/child-bg slide's empty first-paint frame shows the dark
                    // nav panel, not a white flash.
                    style={{ background: slideRootBackground(item.slide.html, "transparent") }}
                  >
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
                  this slide, dim the thumbnail and show the branded
                  paragraph-write animation. Same affordance as the
                  hero's in-flight overlay; matches the streaming-
                  generation placeholder cells above so a peer who
                  joins mid-generation sees ONE loading vocabulary
                  across the deck instead of two (generic spinner +
                  branded icon). 2026-05-27 — replaced the legacy
                  `.spinner` ring with `<ParagraphWriteIcon />`. */}
              {item.kind === "slide" && item.regenerating ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
                  <ParagraphWriteIcon
                    rtl={language === "ar"}
                    size={20}
                    className="text-foreground/70"
                  />
                </div>
              ) : null}

              {/* Locked overlay — centred padlock icon on a faintly
                  tinted backdrop. Replaces the old top-left corner
                  badge so the locked state is unmissable at a glance
                  (user feedback 2026-05-20). The opacity dim on the
                  thumbnail content above + this overlay together
                  give the slide a "frozen" look. */}
              {isLocked || isTeaser ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
                  <span
                    className="material-symbols-outlined text-foreground drop-shadow-lg"
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

              {/* Draft chip — logical TOP-START corner while the deck
                  is still generating (the model may re-emit this slide
                  as a correction before the deck lands). Warn-tint
                  status tokens; disappears with the streaming nav items
                  once the completed manifest takes over. */}
              {item.kind === "slide" && item.draft ? (
                <span
                  className="pointer-events-none absolute start-1 top-1 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                  style={{ color: "var(--tq-status-warn-dot)" }}
                >
                  {/* Spinning ring: the draft state is ACTIVE work (the
                      bake's vision review is in flight), not a passive tag. */}
                  <span
                    className="spinner h-2.5 w-2.5 shrink-0 rounded-full border"
                    style={{
                      borderColor: "color-mix(in srgb, var(--tq-status-warn-dot) 30%, transparent)",
                      borderTopColor: "var(--tq-status-warn-dot)",
                    }}
                  />
                  {dict.editor.nav.draftChip}
                </span>
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
      )}

      {/* §22: document actions (Export ▾ + Share) — relocated here from the
          removed StudioHeader. Slides tab only; the parent gates content
          (owner / manifest ready). */}
      {actionsSlot && tab === "slides" ? (
        <footer className="border-t border-foreground/[0.08] pt-3 px-1">
          {actionsSlot}
        </footer>
      ) : null}

      {/* Footer — teaser paywall CTA (free tier). Accent .btn-gradient matching
          the per-slot unlock buttons on the locked tiles. Slides tab only. */}
      {showTeaserUnlock && tab === "slides" ? (
        <footer className={actionsSlot ? "pt-2 px-1" : "border-t border-foreground/[0.08] pt-3 px-1"}>
          <button
            type="button"
            onClick={onTeaserUnlock}
            disabled={teaserUnlockBusy}
            className="btn-gradient inline-flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-70"
          >
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 16 }}
              aria-hidden
            >
              lock_open
            </span>
            {dict.editor.nav.teaserUnlock}
          </button>
        </footer>
      ) : null}
      {/* Cancel pill — shown ONLY when the parent (DeckView)
          wires `onCancelGeneration` (i.e. the project is mid-
          generation AND the viewer has edit rights). Distinct red-
          tinted variant of the lock pill chrome so it reads as a
          destructive action without competing visually with the
          deck-nav above. The actual confirm modal lives in DeckView
          to keep this component layout-only. */}
      {onCancelGeneration ? (
        <footer className="border-t border-foreground/[0.08] pt-3 px-1">
          <button
            type="button"
            onClick={onCancelGeneration}
            disabled={cancelDisabled}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[var(--tq-status-down-border)] bg-[var(--tq-status-down-bg)] px-4 py-2 text-sm font-semibold text-[var(--tq-status-down-text)] transition-colors hover:border-red-400/50 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 16 }}
              aria-hidden
            >
              stop_circle
            </span>
            {cancelDisabled ? dict.editor.nav.cancelling : dict.editor.nav.cancelGeneration}
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
