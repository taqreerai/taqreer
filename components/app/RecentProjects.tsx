"use client";

// Dashboard widget: "أحدث المشاريع" (Recent Projects).
//
// Layout: 3-column grid, max 6 items (2 rows × 3 cols). The dashboard
// page caps the query at `take: 6` newest-first; the grid also caps
// locally (defence-in-depth — a 7th tile would wrap to a half-empty
// row and break the visual contract).
//
// Tile chrome (3-dots menu, inline rename, trash confirm, lightbox,
// optimistic delete) lives inside `ProjectsGrid`; this widget just
// adds the widget-scoped chrome (header + "see all" link + empty
// state) around it.

import {
  DashboardEmptyState,
  DashboardWidget,
  DashboardWidgetHeader,
} from "@/components/app/DashboardWidget";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";

export function RecentProjects({
  projects,
}: {
  projects: ProjectsGridProject[];
}) {
  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="أحدث المشاريع" href="/projects" />
      <ProjectsGrid
        projects={projects}
        gridClassName="grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
        cap={6}
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
