"use client";

// Shared project-grid component. Three call sites today:
//   • RecentProjects (dashboard widget, capped at 6, 3-column)
//   • FavoritesGrid (/favorites page, uncapped, 5-column)
//   • ProjectsPageClient (/projects page, paginated 5-col)
//
// Renders the tile loop + optimistic-delete `deletedIds` set. Does
// NOT mount a lightbox (post route-split 2026-05-21 — project tiles
// navigate to `/project/<id>` on click, the lightbox is reserved
// for the templates flow). Does NOT own filtering or page chrome —
// callers pass an already-filtered `projects` array and the empty
// state to render when it's empty.
//
// Optimistic favorite-removal (used by /favorites to drop a tile
// when the user un-stars it from THIS view) is NOT here — that
// concern lives in the caller (FavoritesGrid), which filters its
// `projects` prop before handing it down. Mixing favorite-state
// into the grid would force every other caller to opt out of a
// behaviour they don't want.

import { useMemo, useState } from "react";
import { ProjectThumbnail } from "@/components/app/ProjectThumbnail";
import type { SlideFormat } from "@/lib/schema/slide";

export type ProjectsGridProject = {
  id: string;
  title: string;
  createdAt: Date | string;
  thumbnailUrls: string[];
  format: string;
  isFavorite: boolean;
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
  // Hard cap on visible tiles (defence-in-depth for the dashboard's
  // `take: 6` SQL guarantee). Defaults to no cap.
  cap?: number;
  // When set, the grid renders invisible placeholder cells AFTER the
  // real tiles so the total cell count always equals `padTo`. Used
  // by paginated pages so the grid reserves a fixed area regardless
  // of how many items the current page contains — pagination
  // controls below the grid stay at a stable Y position instead of
  // creeping up when the last page is partial.
  padTo?: number;
  // Rendered when `projects` is empty AFTER applying the cap +
  // deleted-id filter. Caller decides which empty-state variant
  // (no data yet, filtered to zero, etc.) makes sense for the page.
  emptyState: React.ReactNode;
  // Optional: forwarded to each ProjectThumbnail so callers that
  // care about un-star events (e.g. /favorites) can react.
  onFavoriteChange?: (projectId: string, isFavorite: boolean) => void;
};

export function ProjectsGrid({
  projects,
  gridClassName,
  cap,
  padTo,
  emptyState,
  onFavoriteChange,
}: Props) {
  // Set of project IDs the user has just trashed. Filtered out of
  // `visibleProjects` so the tile disappears the moment the DELETE
  // round-trip succeeds. Client-side state — re-fetched truth
  // arrives via the parent on the next navigation.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((p) => !deletedIds.has(p.id));
    return cap !== undefined ? filtered.slice(0, cap) : filtered;
  }, [projects, deletedIds, cap]);

  if (visibleProjects.length === 0) {
    return <>{emptyState}</>;
  }

  const placeholderCount =
    padTo !== undefined ? Math.max(0, padTo - visibleProjects.length) : 0;

  return (
    <div className={`grid ${gridClassName}`}>
      {visibleProjects.map((project) => (
        <ProjectThumbnail
          key={project.id}
          projectId={project.id}
          slides={project.thumbnailUrls}
          format={project.format === "9:16" ? "9:16" : ("16:9" as SlideFormat)}
          title={project.title}
          createdAt={project.createdAt}
          isFavorite={project.isFavorite}
          // No `onOpen` — tiles navigate to /project/<id> on click
          // (the new default in ProjectThumbnail post route-split).
          // Templates can pass `onOpen` later to opt into the
          // ProjectLightbox preview UX instead.
          onDeleted={(id) =>
            setDeletedIds((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            })
          }
          onFavoriteChange={onFavoriteChange}
        />
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
