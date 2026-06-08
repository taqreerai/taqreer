"use client";

// §22: home dashboard's bottom "library" card — Lovable-style. ONE card whose
// header carries a segmented toggle (مشاريعي ⇄ القوالب) that's always visible;
// the body swaps between the recent-projects grid and the saved-templates grid.
// Reuses the existing grids verbatim (ProjectsGrid + embedded MyTemplates) so
// the tiles, lightbox, and actions stay identical to /projects and /templates.

import { useState } from "react";
import Link from "next/link";
import { SegmentedToggle } from "@/components/create/controls";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";
import {
  MyTemplates,
  type MyTemplatesTemplate,
} from "@/components/app/MyTemplates";

type Tab = "projects" | "templates";

export function HomeLibrary({
  projects,
  templates,
}: {
  projects: ProjectsGridProject[];
  templates: MyTemplatesTemplate[];
}) {
  const [tab, setTab] = useState<Tab>("projects");

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6" dir="rtl">
      <header className="mb-5 flex items-center justify-between gap-3">
        <SegmentedToggle<Tab>
          options={[
            { value: "projects", label: "مشاريعي" },
            { value: "templates", label: "القوالب" },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="المشاريع أو القوالب"
          size="comfortable"
        />
        <Link
          href={tab === "projects" ? "/projects" : "/templates"}
          className="tq-widget-link no-underline"
        >
          عرض الكل
        </Link>
      </header>

      {tab === "projects" ? (
        <ProjectsGrid
          projects={projects}
          gridClassName="grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          emptyState={
            <p className="py-10 text-center text-sm text-muted">
              لا توجد مشاريع بعد — ابدأ من البطاقات بالأعلى.
            </p>
          }
        />
      ) : (
        <MyTemplates templates={templates} embedded />
      )}
    </div>
  );
}
