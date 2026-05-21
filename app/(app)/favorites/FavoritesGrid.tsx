"use client";

// Client grid for /favorites. Mirrors the RecentProjects pattern
// (shared lightbox instance + optimistic-delete set) but:
//   • 6 tiles per row at the largest breakpoint (vs. 3 on the
//     dashboard widget) — tiles are smaller because this page is
//     a dedicated browse view, not a sidebar widget;
//   • no client-side cap — the page query returns every favorited
//     project, no `take: N`;
//   • the empty state is page-scale (full glass-empty-state card),
//     not widget-scale, and CTAs the user back to /dashboard
//     where the favorite toggle lives.
//
// Identical tile chrome to RecentProjects (`ProjectThumbnail` owns
// the 3-dots menu, inline rename, trash dialog). Keep the two grids
// in lockstep until step 11 — when /projects lands and we have a
// third grid call site, the shared bits get extracted into a single
// component.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProjectThumbnail } from "@/components/app/ProjectThumbnail";
import { ProjectLightbox } from "@/components/app/ProjectLightbox";
import type { SlideFormat } from "@/lib/schema/slide";

type Project = {
  id: string;
  title: string;
  createdAt: Date | string;
  thumbnailUrls: string[];
  format: string;
  isFavorite: boolean;
};

function toFormat(v: string): SlideFormat {
  return v === "9:16" ? "9:16" : "16:9";
}

export function FavoritesGrid({ projects }: { projects: Project[] }) {
  const [openProject, setOpenProject] = useState<Project | null>(null);
  // Optimistic-delete tracking — same pattern as RecentProjects.
  // Stays client-side; reloading the page re-fetches the canonical
  // list from the server.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  // Optimistic-unfavorite tracking. If a user toggles the star OFF
  // from this page's tile menu, we drop the tile immediately even
  // though the SSR data still includes it — without this, the user
  // un-stars a project and sees it remain on the favorites page
  // until a hard reload. ProjectThumbnail doesn't currently expose
  // an `onUnfavorited` callback (RecentProjects doesn't need it
  // because un-starring a dashboard tile is fine — it just keeps
  // showing), so we mirror it from the menu's PATCH response via
  // an `onFavoriteChange` hook below. Kept separate from
  // `deletedIds` so we don't conflate "removed from this view" with
  // "actually trashed".
  const [unfavoritedIds, setUnfavoritedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (p) => !deletedIds.has(p.id) && !unfavoritedIds.has(p.id),
      ),
    [projects, deletedIds, unfavoritedIds],
  );

  if (visibleProjects.length === 0) {
    return (
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
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {visibleProjects.map((project) => (
          <ProjectThumbnail
            key={project.id}
            projectId={project.id}
            slides={project.thumbnailUrls}
            format={toFormat(project.format)}
            title={project.title}
            createdAt={project.createdAt}
            isFavorite={project.isFavorite}
            onOpen={() => setOpenProject(project)}
            onDeleted={(id) =>
              setDeletedIds((prev) => {
                const next = new Set(prev);
                next.add(id);
                return next;
              })
            }
            onFavoriteChange={(id, nextValue) => {
              // Only react to un-starring. Re-starring an already-
              // visible tile is a no-op; un-starring removes it
              // from this view.
              if (!nextValue) {
                setUnfavoritedIds((prev) => {
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
              }
            }}
          />
        ))}
      </div>

      <ProjectLightbox
        open={openProject !== null}
        slides={openProject?.thumbnailUrls ?? []}
        format={openProject ? toFormat(openProject.format) : "16:9"}
        title={openProject?.title ?? ""}
        onClose={() => setOpenProject(null)}
      />
    </>
  );
}
