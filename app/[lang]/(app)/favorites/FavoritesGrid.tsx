"use client";

// Client grid for /favorites. Owns:
//   • deletedIds set (delete optimistic — refactored 2026-05-21
//     so the filter runs BEFORE pagination, otherwise deleting a
//     tile leaves a hole on the current page until the next item
//     would have backfilled into view)
//   • unfavoritedIds set (un-star optimistic — same ordering
//     reason; un-starring a tile on /favorites should drop it
//     immediately, not after a reload)
//   • page state + slice
//
// ProjectsGrid is purely presentational + handles the Framer-Motion
// layout animation for tiles whose position changes (delete /
// un-favorite / page flip).

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";
import { Pagination } from "@/components/app/Pagination";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";
import { useDict } from "@/components/i18n/LocaleProvider";

const PAGE_SIZE = 15;

export function FavoritesGrid({
  projects,
}: {
  projects: ProjectsGridProject[];
}) {
  const dict = useDict();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [unfavoritedIds, setUnfavoritedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [page, setPage] = useState(0);

  // Recovers from save → navigate-too-fast — same hook as
  // /projects + /dashboard. Pre-pagination so we catch a missing
  // tile even if it's not on the current page.
  useRefreshWhileThumbnailsPending(projects);

  const visible = useMemo(
    () =>
      projects.filter(
        (p) => !deletedIds.has(p.id) && !unfavoritedIds.has(p.id),
      ),
    [projects, deletedIds, unfavoritedIds],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Derived clamp (NOT a setState in an effect — same
  // `react-hooks/set-state-in-effect` lint as ProjectsPageClient).
  // Computes during render so a shrinking list (delete /
  // un-favourite) immediately reflects on the visible page,
  // without forcing a follow-up render via setPage.
  const activePage = Math.max(0, Math.min(page, pageCount - 1));
  const paginated = useMemo(
    () =>
      visible.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE),
    [visible, activePage],
  );

  return (
    <>
      <ProjectsGrid
        projects={paginated}
        padTo={PAGE_SIZE}
        staggerKey={activePage}
        gridClassName="grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        onDeleted={(id) =>
          setDeletedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          })
        }
        onFavoriteChange={(id, nextValue) => {
          if (!nextValue) {
            setUnfavoritedIds((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
          }
        }}
        emptyState={
          <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
              star
            </span>
            <h3 className="mb-2 text-base font-semibold text-foreground">
              {dict.components.favoritesGrid.emptyTitle}
            </h3>
            <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
              {dict.components.favoritesGrid.emptyDesc}
            </p>
            <Link
              className="btn-gradient inline-block px-4 py-1.5 text-xs no-underline"
              href="/dashboard"
            >
              {dict.components.favoritesGrid.goToProjects}
            </Link>
          </div>
        }
      />
      <Pagination page={activePage} pageCount={pageCount} onChange={setPage} />
    </>
  );
}
