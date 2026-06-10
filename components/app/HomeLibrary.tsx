"use client";

// §22: home dashboard's bottom "library" card — Lovable-style. ONE card whose
// header carries a segmented toggle (مشاريعي ⇄ القوالب) that's always visible;
// the body swaps between the recent-projects grid and the saved-templates grid.
// Reuses the existing grids verbatim (ProjectsGrid + embedded MyTemplates) so
// the tiles, lightbox, and actions stay identical to /projects and /templates.

import { useState } from "react";
import Link from "next/link";
import { SegmentedToggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
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
  const dict = useDict();
  const { locale } = useLocale();

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <SegmentedToggle<Tab>
          options={[
            { value: "projects", label: dict.nav.projects },
            { value: "templates", label: dict.nav.templates },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel={dict.homeLibrary.toggleAria}
          size="comfortable"
        />
        <Link
          href={localizedHref(tab === "projects" ? "/projects" : "/templates", locale)}
          className="tq-widget-link no-underline"
        >
          {dict.homeLibrary.viewAll}
        </Link>
      </header>

      {tab === "projects" ? (
        <ProjectsGrid
          projects={projects}
          gridClassName="grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          emptyState={
            <p className="py-10 text-center text-sm text-muted">
              {dict.homeLibrary.noProjects}
            </p>
          }
        />
      ) : (
        <MyTemplates templates={templates} embedded />
      )}
    </div>
  );
}
