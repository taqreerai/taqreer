"use client";

// Client grid for /favorites. Composes `ProjectsGrid` (shared with
// the dashboard + /projects) and adds the favorites-specific
// behaviour: drop a tile from this view the moment the user
// un-stars it from its 3-dots menu, without waiting for a reload.
//
// ProjectsGrid doesn't own this concern because un-starring is fine
// on the dashboard (the tile stays — it's still a recent project,
// just no longer favorited). Only /favorites cares.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";
import { Pagination } from "@/components/app/Pagination";

// Same page size as /projects so the two browse views share a
// rhythm; Pagination auto-hides when there's only one page so a
// typical small favourites list shows no controls at all.
const PAGE_SIZE = 15;

export function FavoritesGrid({
  projects,
}: {
  projects: ProjectsGridProject[];
}) {
  // Optimistic-unfavorite tracking. The favorite PATCH lands with
  // the new `isFavorite` value via ProjectThumbnail's
  // `onFavoriteChange` callback; we drop the tile if it just flipped
  // OFF. Stays client-side; refresh reloads the canonical list.
  const [unfavoritedIds, setUnfavoritedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [page, setPage] = useState(0);

  const visible = projects.filter((p) => !unfavoritedIds.has(p.id));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paginated = useMemo(
    () => visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [visible, page],
  );

  return (
    <>
      <ProjectsGrid
        projects={paginated}
        padTo={PAGE_SIZE}
        gridClassName="grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
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
          <div className="glass-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
              star
            </span>
            <h3 className="mb-2 text-base font-semibold text-white">
              لا توجد مشاريع مفضلة بعد
            </h3>
            <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
              اضغط على النجمة من قائمة خيارات أي مشروع لإضافته إلى هذه الصفحة.
            </p>
            <Link
              className="btn-gradient inline-block px-4 py-1.5 text-xs no-underline"
              href="/dashboard"
            >
              اذهب إلى المشاريع
            </Link>
          </div>
        }
      />
      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </>
  );
}
