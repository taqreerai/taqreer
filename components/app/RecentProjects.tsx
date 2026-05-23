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
import { useRouter } from "next/navigation";
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
  // delete would leave a hole. The dashboard query is server-capped
  // at 6; the optimistic set hides the deleted tile immediately
  // while `router.refresh()` re-runs the SSR query and backfills
  // the 7th-most-recent project into the empty slot. Without the
  // refresh the grid would stick at 5 tiles until next navigation
  // (the bug user flagged 2026-05-24).
  const router = useRouter();
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
        gridClassName="grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3"
        onDeleted={(id) => {
          // Two-step: (1) optimistic hide via the local set so the
          // tile disappears INSTANTLY (no flash of the deleted card
          // while the SSR round-trip is in flight); (2) router.refresh
          // re-runs the dashboard's projects query — the deleted row
          // is gone server-side, and the next-most-recent project
          // moves into slot 6, filling the hole.
          setDeletedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          router.refresh();
        }}
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
