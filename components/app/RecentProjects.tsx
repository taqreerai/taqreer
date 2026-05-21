"use client";

// Dashboard widget: "أحدث المشاريع" (Recent Projects).
//
// Layout: 3-column grid, max 6 items (2 rows × 3 cols). Caps locally
// after filtering out client-deleted IDs so a tile dropped via the
// 3-dots menu doesn't leave a hole in the grid (refactored
// 2026-05-21 — ProjectsGrid is now purely presentational + the
// delete-state lives here at the caller).
//
// Tile chrome (3-dots menu, inline rename, trash confirm) lives
// inside ProjectThumbnail; this widget just adds the widget-scoped
// chrome (header + "see all" link + empty state) around the grid.

import { useState } from "react";
import {
  DashboardEmptyState,
  DashboardWidget,
  DashboardWidgetHeader,
} from "@/components/app/DashboardWidget";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";

const MAX_VISIBLE = 6;

export function RecentProjects({
  projects,
}: {
  projects: ProjectsGridProject[];
}) {
  // Optimistic-delete tracking lives here (NOT inside ProjectsGrid)
  // so the filter runs BEFORE the cap — without this ordering a
  // delete would leave a hole. The dashboard query is already capped
  // at 6 on the server, so deletes naturally trim to 5/4/3/...
  // without a backfill seventh item. Acceptable; users see fewer
  // tiles until they navigate away and back.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const visible = projects
    .filter((p) => !deletedIds.has(p.id))
    .slice(0, MAX_VISIBLE);

  // Recovers from the save → navigate-too-fast race: if any visible
  // tile has no thumbnails yet (Inngest render job still running),
  // schedule a router.refresh() at 3 s and 8 s. Caller-level so the
  // shared ProjectsGrid stays purely presentational.
  useRefreshWhileThumbnailsPending(visible);

  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="أحدث المشاريع" href="/projects" />
      <ProjectsGrid
        projects={visible}
        gridClassName="grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
        onDeleted={(id) =>
          setDeletedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          })
        }
        emptyState={
          <DashboardEmptyState
            icon="add_circle"
            title="لا توجد مشاريع بعد"
            description="ابدأ بإنشاء أول عرض تقديمي وسيظهر هنا فور حفظه."
            action={{ label: "إنشاء مشروع", href: "/create" }}
          />
        }
      />
    </DashboardWidget>
  );
}
