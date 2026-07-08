"use client";

// Shared project-grid component. Three call sites today:
//   • RecentProjects (dashboard widget, capped at 6, 3-column)
//   • FavoritesGrid (/favorites page, paginated 5-column)
//   • ProjectsPageClient (/projects page, paginated 5-column,
//     filter-driven)
//
// PURELY PRESENTATIONAL. Renders the tile loop + Framer-Motion
// layout animation. Does NOT mount a lightbox (post route-split
// 2026-05-21 — project tiles navigate to `/project/<id>` on click,
// the lightbox is reserved for the templates flow). Does NOT own
// filtering, pagination, deletion, or favorite-state tracking —
// callers handle ALL of that and pass the final-rendered array in.
//
// Why the caller owns delete-state (refactored 2026-05-21):
// previously ProjectsGrid kept its own `deletedIds` set and
// filtered+sliced the `projects` prop internally. That broke
// pagination — the caller would slice to PAGE_SIZE BEFORE the
// grid's delete-filter ran, so on /projects deleting a tile left
// a permanent hole on that page (14 visible + 1 invisible
// placeholder) instead of the 16th project sliding up into view.
// Now the caller filters first, then slices — the next project
// in the unsliced list backfills automatically.
//
// `motion.div` with the `layout` prop animates each tile's
// position when the rendered set changes (delete, filter,
// pagination). Smooth backfill on delete, smooth re-layout when
// a filter narrows results.

import { motion } from "framer-motion";
import { ProjectThumbnail } from "@/components/app/ProjectThumbnail";
import { SelectableTile } from "@/components/app/SelectableTile";
import { SLIDE_FORMATS, type SlideFormat } from "@/lib/schema/slide";

// Fade-in cascade REMOVED 2026-05-25. The per-tile `motion.div` used
// to mount with `initial: { opacity: 0 } → animate: { opacity: 1 }`
// plus a per-tile delay for a domino effect. Got dropped because
// framer-motion's `initial → animate` doesn't reliably re-fire when
// the React tree is restored from bfcache (Safari, sometimes Chrome)
// or Next.js's router cache (any browser) on browser-back navigation.
// Tiles ended up in the DOM but stuck at `opacity: 0` — a blank grid
// with no tiles and no empty state. User-reported on /dashboard AND
// /projects 2026-05-25. /templates was unaffected because it never
// had the animation in the first place.
//
// `layout` (Framer's position animation for delete-backfill / filter
// reflow) stays — it only fires on position changes, never on initial
// mount or restore, so it's bfcache-safe.

export type ProjectsGridProject = {
  id: string;
  title: string;
  createdAt: Date | string;
  thumbnailUrls: string[];
  format: string;
  isFavorite: boolean;
  // True when the deck has been saved (so the thumbnail-render
  // Inngest job WAS queued) but `thumbnailUrls` is still empty —
  // the job hasn't written its output yet. Drives the loading
  // spinner overlay on the tile (replacing the static placeholder
  // icon). Legacy decks that were never saved have this false even
  // with empty thumbnailUrls, so they get the static placeholder
  // instead of a spinner-that-never-resolves.
  thumbnailsPending: boolean;
  // "edit" | "comment" when the deck is SHARED WITH the viewer
  // (accepted invite - 2026-06-12); null/undefined for owned decks.
  // Renders the small shared badge on the tile.
  sharedRole?: string | null;
};

type Props = {
  projects: ProjectsGridProject[];
  // Tailwind grid classes for column layout. Caller decides density:
  //   • dashboard widget: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
  //   • favorites + projects: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
  // Kept as a string prop (not a column-count enum) so future tweaks
  // — different breakpoints, adaptive layouts — don't need component
  // surface changes.
  gridClassName: string;
  // When set, the grid renders invisible placeholder cells AFTER the
  // real tiles so the total cell count always equals `padTo`. Used
  // by paginated pages so the grid reserves a fixed area regardless
  // of how many items the current page contains — pagination
  // controls below the grid stay at a stable Y position instead of
  // creeping up when the last page is partial.
  padTo?: number;
  // When this value changes, the grid replays its staggered fade-in
  // (domino: tile 1 → tile N over ~800 ms). Callers pass their
  // pagination page index here so navigating between pages triggers
  // the cascade. NOT changing it (delete, filter, un-favourite,
  // dashboard with no pagination) keeps the children mounted —
  // they just animate position via Framer's `layout` instead.
  staggerKey?: string | number;
  // Rendered when `projects` is empty. Caller decides which empty-
  // state variant (no data yet, filtered to zero, etc.) makes sense.
  emptyState: React.ReactNode;
  // Forwarded to each ProjectThumbnail. Called AFTER the DELETE
  // round-trip succeeds; caller updates its own deletedIds set.
  onDeleted?: (projectId: string) => void;
  // Forwarded similarly — used by /favorites to drop a tile when
  // the user un-stars it from this view.
  onFavoriteChange?: (projectId: string, isFavorite: boolean) => void;
  // Multi-select mode (2026-06-12): when provided AND active, every
  // tile is wrapped in a SelectableTile overlay (clicks toggle instead
  // of navigating). Shared-with-me decks are not selectable (the
  // viewer cannot delete them).
  selection?: {
    active: boolean;
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
  };
};

export function ProjectsGrid({
  projects,
  gridClassName,
  padTo,
  staggerKey,
  emptyState,
  onDeleted,
  onFavoriteChange,
  selection,
}: Props) {
  if (projects.length === 0) {
    return <>{emptyState}</>;
  }

  const placeholderCount =
    padTo !== undefined ? Math.max(0, padTo - projects.length) : 0;

  return (
    <div
      // The `staggerKey` is what triggers the domino fade-in cascade.
      // When the caller's page index changes, this wrapper remounts
      // (via key), which remounts every child motion.div, which
      // re-fires their `initial → animate` transition with the
      // per-child `delay`. When `staggerKey` doesn't change (delete
      // / filter / un-favourite / dashboard updates), the wrapper
      // stays mounted, children keep their stable keys, and only
      // Framer's `layout` animation runs on position changes —
      // exactly the UX split we want (cinematic on page-flip;
      // instantaneous on in-page mutations).
      //
      // Why per-child `delay` instead of parent `staggerChildren`
      // variants: combining `layout` with variant-driven staggers
      // didn't propagate to children reliably (verified live
      // 2026-05-21 — tiles stuck at opacity 0). The explicit-delay
      // path doesn't depend on variant inheritance, so `layout`
      // and the fade-in compose cleanly.
      key={staggerKey ?? "default"}
      className={`grid ${gridClassName}`}
    >
      {projects.map((project) => (
        // `layout` animates position changes (delete backfill,
        // filter narrow). Fires only on position deltas — never on
        // mount or bfcache restore — so it's safe to keep when the
        // fade-in cascade isn't. The cascade itself (initial:opacity:0
        // → animate:opacity:1, per-tile delay) was REMOVED 2026-05-25;
        // see the module header for why. Tiles now render at default
        // opacity (1) immediately, the same way /templates' tiles do.
        <motion.div
          key={project.id}
          layout
        >
          <SelectableTile
            active={selection?.active ?? false}
            selected={selection?.selected.has(project.id) ?? false}
            disabled={project.sharedRole != null}
            onToggle={() => selection?.onToggle(project.id)}
          >
          <ProjectThumbnail
            projectId={project.id}
            slides={project.thumbnailUrls}
            format={
              SLIDE_FORMATS.includes(project.format as SlideFormat)
                ? (project.format as SlideFormat)
                : "16:9"
            }
            title={project.title}
            createdAt={project.createdAt}
            isFavorite={project.isFavorite}
            thumbnailsPending={project.thumbnailsPending}
            sharedRole={project.sharedRole ?? null}
            // No `onOpen` — tiles navigate to /project/<id> on click
            // (the default in ProjectThumbnail post route-split).
            // Templates can pass `onOpen` later to opt into the
            // ProjectLightbox preview UX instead.
            onDeleted={onDeleted}
            onFavoriteChange={onFavoriteChange}
          />
          </SelectableTile>
        </motion.div>
      ))}
      {Array.from({ length: placeholderCount }, (_, i) => (
        // Structural mirror of ProjectThumbnail's outer markup so
        // each placeholder occupies the identical grid cell
        // footprint a real tile would. Without the `w-full` on the
        // thumbnail box, `aspect-video` collapses to 0×0 inside the
        // flex-col context (caught 2026-05-21 during partial-page
        // pagination Y testing — placeholders came out 40 px tall
        // vs real tiles' ~150 px). `opacity-0 pointer-events-none`
        // keeps the cell invisible + non-interactive without the
        // `visibility: hidden` quirks that earlier broke layout.
        // NOT wrapped in motion.div — placeholders are pure
        // structural padding, not real items, so animating their
        // position is wasted work + would cause visual jitter as
        // they're added/removed between renders.
        <div
          key={`tile-placeholder-${i}`}
          aria-hidden
          className="pointer-events-none opacity-0 flex flex-col gap-3"
        >
          <div className="aspect-video w-full rounded-[14px]" />
          <div className="flex items-start justify-between gap-2 px-0.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight">.</p>
              <p className="mt-0.5 text-[10px]">.</p>
            </div>
            <div className="h-7 w-7 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
