"use client";

// Dashboard widget: "أحدث المشاريع" (Recent Projects).
//
// Layout: 3-column grid, max 6 items (2 rows × 3 cols). The dashboard
// page caps the query at `take: 6` newest-first.
//
// Each tile is a full-bleed `ProjectThumbnail`:
//   • Default state: just the WebP thumbnail of slide 1.
//   • On hover: thumbnail dims, title + creation date appear at
//     bottom-end, 3-dots menu trigger appears at top-end.
//   • Click thumbnail → opens the project lightbox.
//   • Click 3-dots → opens the actions menu (built in step 9f).
//
// The lightbox lives one level up (here, NOT inside the tile) so we
// keep a single instance for the whole widget — opening tile A and
// then tile B reuses the same modal instead of mounting per-tile
// modals (Framer Motion would treat them as separate trees and
// double-fade).
//
// The 3-dots menu state ALSO lives here (step 9f will hook in). For
// now `onOpenMenu` is a no-op placeholder; the next step wires the
// actual `<ProjectActionsMenu>` portal.

import { useState } from "react";
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
};

function toFormat(v: string): SlideFormat {
  return v === "9:16" ? "9:16" : "16:9";
}

export function RecentProjects({ projects }: { projects: Project[] }) {
  // Currently-open lightbox project, or null. Holding the whole
  // project object (not just id) so closing → reopening a different
  // tile doesn't flash placeholder state mid-transition.
  const [openProject, setOpenProject] = useState<Project | null>(null);

  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="أحدث المشاريع" href="/projects" />

      {projects.length === 0 ? (
        <DashboardEmptyState
          icon="add_circle"
          title="لا توجد مشاريع بعد"
          description="ابدأ بإنشاء أول عرض تقديمي وسيظهر هنا فور حفظه."
          action={{ label: "إنشاء مشروع", href: "/create" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectThumbnail
              key={project.id}
              slides={project.thumbnailUrls}
              format={toFormat(project.format)}
              title={project.title}
              createdAt={project.createdAt}
              onOpen={() => setOpenProject(project)}
              // Step 9f will wire the actions menu here. Placeholder
              // for now so the 3-dots button still renders and is
              // ready to receive the menu's open/closed state.
              onOpenMenu={() => undefined}
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
