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
//   • Title (or rename input when renameMode=true) + creation
//     date on the start side (visual right in RTL).
//   • 3-dots menu trigger on the end side (visual left in RTL).
//     Stamped `data-project-menu-trigger` so the menu's outside-
//     click handler ignores it (otherwise the trigger's own click
//     re-opens the menu after the mousedown closes it — same
//     pattern as HistoryPopover's exclusion).
//
// MENU + ACTIONS (step 9f):
//   Per-tile state for menu open/closed, rename mode, and the
//   optimistic favorite toggle lives here. Three side effects
//   bubble up to the parent:
//     • onDeleted(projectId) — fires after a successful trash
//       DELETE so the dashboard can drop the tile from its list.
//     • onRenamed(projectId, title) — optional; lets the parent
//       reflect the new title elsewhere (none currently uses it,
//       but parity with onDeleted keeps the API symmetrical).
//   Favorite is local-only; nothing else on the dashboard reacts
//   to it. The /favorites page will fetch fresh.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import type { SlideFormat } from "@/lib/schema/slide";
import { ProjectActionsDialogs } from "@/components/app/ProjectActionsDialogs";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import {
  MAX_TITLE_LENGTH,
  useProjectActions,
} from "@/lib/hooks/useProjectActions";
import { useSlideScrub } from "@/lib/hooks/useSlideScrub";
import { ScrubCounter } from "@/components/app/ScrubCounter";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

type Props = {
  // Stable per-project — drives API calls + clipboard URL.
  projectId: string;
  slides: string[];
  format: SlideFormat;
  title: string;
  createdAt: Date | string;
  isFavorite: boolean;
  // True when the thumbnail-render Inngest job has been queued (deck
  // is saved) but its output hasn't landed in `slides` yet. Drives
  // the loading spinner overlay so users see "thumbnails are coming"
  // instead of a stale-looking placeholder. Always false for legacy
  // decks that have never been saved — those get the static
  // placeholder icon (spinner that never resolves would be worse UX
  // than acknowledging "no thumbnails available").
  thumbnailsPending?: boolean;
  // Optional click-override. Default behaviour (post route split,
  // 2026-05-21) is to navigate to `/project/<id>` — the canonical
  // working-session route. Pass `onOpen` to opt back into a
  // callback-driven flow (e.g. the templates page renders the
  // ProjectLightbox preview instead of navigating). Project tiles
  // on /dashboard, /favorites, /projects don't pass it and use
  // the navigate default.
  onOpen?: () => void;
  // Fires AFTER the DELETE round-trip succeeds. Parent uses this
  // to drop the tile from its rendered list (we don't unmount
  // ourselves — the parent owns the projects array).
  onDeleted?: (projectId: string) => void;
  // Optional: notify parent of a successful rename. Tile updates
  // its own local title optimistically; this exists so other
  // surfaces showing the same title (none today) can sync.
  onRenamed?: (projectId: string, newTitle: string) => void;
  // Optional: notify parent of a confirmed favorite-state change
  // (server response landed). Used by /favorites to drop the tile
  // immediately when the user un-stars — without this, un-starring
  // a tile on the favorites view leaves it sitting there until the
  // user reloads, because the SSR `projects` array still has it.
  // RecentProjects doesn't pass this prop (dashboard tiles stay
  // regardless of star state) so behaviour there is unchanged.
  onFavoriteChange?: (projectId: string, isFavorite: boolean) => void;
};

export function ProjectThumbnail({
  projectId,
  slides,
  format,
  title,
  createdAt,
  isFavorite,
  thumbnailsPending = false,
  onOpen,
  onDeleted,
  onRenamed,
  onFavoriteChange,
}: Props) {
  const router = useRouter();
  const dict = useDict();
  const { dir } = useLocale();
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // Thumbnail-hover flag — flips title + 3-dots between muted /
  // white. Tracked in JS (not CSS group/peer) because the title
  // and dots live in a footer that's a sibling-of-sibling of the
  // thumbnail (Tailwind `peer-hover:` only walks one sibling
  // level). Easier to set state than to restructure DOM for a
  // CSS selector.
  const [thumbHovered, setThumbHovered] = useState(false);

  // ── Step 9f state ──────────────────────────────────────────────
  // Shared project actions — menu / rename / favorite / delete / share /
  // use-as-template state + handlers + the four portalled dialogs live in
  // useProjectActions + <ProjectActionsDialogs>. Only this tile's LAYOUT
  // (thumbnail + footer) is local; the scrub/hover state above stays here.
  const actions = useProjectActions(projectId, {
    initialFavorite: isFavorite,
    initialTitle: title,
    menuBtnRef,
    renameInputRef,
    onDeleted,
    onRenamed,
    onFavoriteChange,
  });

  // Hover-scrub through the slide thumbnails — shared with TemplateTile.
  const scrub = useSlideScrub(slides, rootRef);
  const src = slides[scrub.displayIndex] ?? null;
  const hasSlides = slides.length > 0;

  const imgObjectClass =
    format === "9:16" ? "object-cover object-top" : "object-cover";

  const relativeDate = formatDistanceToNow(new Date(createdAt), {
    addSuffix: true,
    locale: ar,
  });

  // ── Menu actions ───────────────────────────────────────────────
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
          // Tile click → navigate to /project/<id> by default; if
          // the caller passes `onOpen`, that wins (templates open
          // the ProjectLightbox preview instead of navigating).
          //
          // Always clickable — including tiles without thumbnails.
          // Pre-step-8b decks (and any deck whose thumbnail render
          // failed) have `thumbnailUrls: []`, so the previous
          // `disabled={!hasSlides}` gate made them unreachable from
          // the dashboard. After the route split that's wrong:
          // the working session at /project/<id> is valid regardless
          // of whether thumbnails were generated, so the click
          // should still navigate.
          onClick={() =>
            onOpen ? onOpen() : router.push(`/project/${projectId}`)
          }
          onMouseMove={scrub.handleMouseMove}
          onMouseLeave={scrub.handleMouseLeave}
          aria-label={
            hasSlides
              ? dict.components.projectThumbnail.open
                  .replace("{title}", actions.titleState)
                  .replace("{count}", String(slides.length))
                  .replace(
                    dict.components.projectThumbnail.slideMany,
                    slides.length === 1
                      ? dict.components.projectThumbnail.slideOne
                      : dict.components.projectThumbnail.slideMany,
                  )
              : dict.components.projectThumbnail.open
                  .replace("{title}", actions.titleState)
                  .split("—")[0]
                  .trimEnd()
          }
          className={`absolute inset-0 block ${
            onOpen ? "cursor-zoom-in" : "cursor-pointer"
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
          ) : thumbnailsPending ? (
            // Deck just saved (Inngest thumbnail job in flight) OR
            // still mid-generation (initial deck-generate run hasn't
            // finished yet). Both cases render the branded paragraph-
            // write animation — replaced the Material Symbols
            // `progress_activity` glyph 2026-05-27 so the dashboard
            // tile, slide-nav thumbnails, and canvas overlay all
            // share ONE loading vocabulary across the app. Sized to
            // match the prior `.tq-icon-lg` (32 px) so the visual
            // footprint inside the tile doesn't shift.
            <span
              role="status"
              aria-label={dict.components.projectThumbnail.creatingPreview}
              className="flex h-full w-full items-center justify-center text-muted"
            >
              <ParagraphWriteIcon size={32} />
            </span>
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-muted opacity-25">
                image
              </span>
            </span>
          )}
        </button>

        {/* "Use as a template" loader — dims THIS thumbnail + shows the
            shared paragraph-write animation while the project's PDF +
            Mimic reference are prepared (instead of a full-screen route
            loader). Covers the click surface so it can't be re-fired. */}
        {actions.useTplBusy ? (
          <div
            role="status"
            aria-label={dict.components.projectThumbnail.preparingTemplate}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-white"
          >
            <ParagraphWriteIcon size={32} />
          </div>
        ) : null}

        {/* Scrub counter — bottom-end (left in RTL). Only while
            scrubbing a multi-slide deck. Outside the click surface
            but inside the rounded thumbnail container. */}
        {scrub.isMultiSlide && scrub.hoverIndex !== null ? (
          <ScrubCounter index={scrub.hoverIndex} total={slides.length} />
        ) : null}

        {/* Favorited indicator — top-start corner. Diagonal-opposite
            of the scrub counter so the two never crowd. Matches the
            counter's bg-black/70 chrome so the star reads against
            any slide content (light or dark). Inline FILL=1 because
            the global material-symbols-outlined rule sets FILL=0;
            without this the glyph would render as an outline. */}
        {actions.favoriteState ? (
          <span
            aria-label={dict.components.projectThumbnail.favorite}
            className="material-symbols-outlined tq-fav-indicator pointer-events-none absolute top-2 start-2 h-[18px] w-[18px] rounded-full bg-black/70 text-white"
          >
            star
          </span>
        ) : null}
      </div>

      {/* Info row — title (or rename input) + creation date on the
          start side (right in RTL), 3-dots menu trigger on the end
          side (left in RTL). Always visible, no hover gating.
          No horizontal padding so the 3-dots button can align flush
          with the thumbnail's visual-left edge (see button's `-me-3`
          for the offset that cancels the glyph's intrinsic padding).
          Same alignment as TemplateTile. */}
      <div dir={dir} className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Title + 3-dots color is driven by INLINE style (not
              Tailwind `text-white`/`text-muted` utilities) because
              the custom `.text-muted` rule in globals.css lives
              OUTSIDE Tailwind's `@layer utilities` and beats the
              layered `.text-white` rule even when only `text-white`
              is on the className — Tailwind v4's @layer cascade
              gives unlayered rules higher priority. Inline-style
              sidesteps the entire layer fight. */}
          {actions.renameMode ? (
            <input
              ref={renameInputRef}
              type="text"
              value={actions.renameDraft}
              onChange={(e) => actions.setRenameDraft(e.target.value)}
              onBlur={actions.commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  actions.commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  actions.cancelRename();
                }
              }}
              disabled={actions.renameSaving}
              maxLength={MAX_TITLE_LENGTH}
              aria-label={dict.components.projectThumbnail.projectName}
              className="w-full truncate rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-xs font-semibold leading-tight text-white outline-none transition-colors focus:border-white/40 disabled:opacity-60"
            />
          ) : (
            <p
              className="truncate text-xs font-semibold leading-tight transition-colors"
              style={{
                color: thumbHovered
                  ? "var(--tq-text-primary)"
                  : "var(--tq-text-muted)",
              }}
              title={actions.titleState}
            >
              {actions.titleState}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-muted">{relativeDate}</p>
        </div>
        <button
          ref={menuBtnRef}
          type="button"
          aria-label={dict.components.projectThumbnail.options}
          aria-haspopup="menu"
          aria-expanded={actions.menuRect !== null}
          // The value (not just the attribute presence) carries the
          // projectId so the menu's outside-click handler can tell
          // "this same tile's trigger" apart from "some OTHER tile's
          // trigger" — clicking tile B's 3-dots now closes tile A's
          // open menu instead of leaving both popped.
          data-project-menu-trigger={projectId}
          onClick={(e) => {
            e.stopPropagation();
            // Toggle: closed → open at current rect, open → close.
            actions.toggleMenu();
          }}
          // Color-only hover (no background tint). The previous
          // `.btn-icon` class added `background: rgba(55,11,244,.18)`
          // on hover which read as a chunky purple chip on every
          // tile — user feedback flagged it as visually heavy. The
          // 3-dots wants to feel invisible until you reach for it
          // and then just brighten.
          //
          // `-me-3` (margin-inline-end: −12 px) pulls the button
          // leftward in RTL by exactly the glyph's intrinsic visual
          // offset (5 px centering padding + 7 px `more_vert` glyph
          // padding within its 18 px font box) so the visible 3 dots
          // sit flush with the thumbnail's left edge. Same alignment
          // formula used in TemplateTile.
          //
          // `hover:text-white!` (Tailwind v4 important modifier) is
          // REQUIRED because the inline `style.color` below sets a
          // color on every render, and inline styles beat unlayered
          // utility rules in normal specificity. Without `!` the
          // muted color held even when the cursor was on the
          // button — user reported "no hover on projects" 2026-05-23.
          className="-mt-0.5 -me-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:text-white!"
          style={{
            // Stays white when favorited (even idle) so the tile reads
            // as "starred" at a glance, paired with the filled-star
            // indicator next to it. Hover behaviour: idle muted →
            // white on hover (via the className above).
            color:
              thumbHovered || actions.favoriteState
                ? "var(--tq-text-primary)"
                : "var(--tq-text-muted)",
          }}
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
      </div>

      {/* Shared actions menu + the save-as-template / trash / share
          dialogs (portalled), driven by the useProjectActions instance. */}
      <ProjectActionsDialogs actions={actions} />
    </div>
  );
}
