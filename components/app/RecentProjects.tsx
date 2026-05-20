"use client";

// Dashboard widget: "أحدث المشاريع" (Recent Projects).
//
// Layout: 3-column grid, max 6 items (2 rows × 3 cols). The dashboard
// page caps the query at `take: 6` newest-first.
//
// Each tile is a full-bleed `ProjectThumbnail` — the tile owns its
// own 3-dots menu (`ProjectActionsMenu`), inline rename mode, and
// trash confirmation dialog (step 9f). This widget keeps the
// shared lightbox (so opening tile A then B reuses one modal
// instance instead of double-fading) and a local set of
// just-deleted projectIds so the grid optimistically drops a tile
// the moment the server confirms a trash delete — no need to
// re-fetch the dashboard for the UI to settle.

import { useMemo, useState } from "react";
import {
  DashboardEmptyState,
  DashboardWidget,
  DashboardWidgetHeader,
} from "@/components/app/DashboardWidget";
import { ProjectThumbnail } from "@/components/app/ProjectThumbnail";
import { ProjectLightbox } from "@/components/app/ProjectLightbox";
import type { SlideFormat } from "@/lib/schema/slide";

type Project = {
  id: string;
  title: string;
  createdAt: Date | string;
  // Per-slide WebPs (step 8 thumbnail pipeline). Newest save wins.
  // Empty array → tile renders the placeholder icon.
  thumbnailUrls: string[];
  // Slide format set at /create time. Drives the 16:9 vs 9:16 crop
  // behaviour in ProjectThumbnail + the lightbox aspect ratio.
  format: string;
  // Step 9f — drives the menu's star icon + label ("Add to favorites"
  // vs. "Remove from favorites"). Optimistic toggles live INSIDE the
  // tile; we don't mirror them here because nothing else on the
  // dashboard reacts to the favorite state.
  isFavorite: boolean;
};

function toFormat(v: string): SlideFormat {
  return v === "9:16" ? "9:16" : "16:9";
}

export function RecentProjects({ projects }: { projects: Project[] }) {
  // Currently-open lightbox project, or null. Holding the whole
  // project object (not just id) so closing → reopening a different
  // tile doesn't flash placeholder state mid-transition.
  const [openProject, setOpenProject] = useState<Project | null>(null);
  // Set of project IDs the user has just trashed. Filtered out of
  // `visibleProjects` so the tile disappears the moment the DELETE
  // round-trip succeeds. The server-rendered prop still contains
  // them until the next dashboard visit — this is purely client
  // state and is fine to lose on reload.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const visibleProjects = useMemo(
    () => projects.filter((p) => !deletedIds.has(p.id)),
    [projects, deletedIds],
  );

  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="أحدث المشاريع" href="/projects" />

      {visibleProjects.length === 0 ? (
        <DashboardEmptyState
          icon="add_circle"
          title="لا توجد مشاريع بعد"
          description="ابدأ بإنشاء أول عرض تقديمي وسيظهر هنا فور حفظه."
          action={{ label: "إنشاء مشروع", href: "/create" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
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
            />
          ))}
        </div>
      )}

      <ProjectLightbox
        open={openProject !== null}
        slides={openProject?.thumbnailUrls ?? []}
        format={openProject ? toFormat(openProject.format) : "16:9"}
        title={openProject?.title ?? ""}
        onClose={() => setOpenProject(null)}
      />
    </DashboardWidget>
  );
}
