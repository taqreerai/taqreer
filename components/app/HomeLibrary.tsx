"use client";

// §22: home dashboard's bottom "library" card — Lovable-style. ONE card whose
// header carries a segmented toggle (مشاريعي ⇄ القوالب) that's always visible;
// the body swaps between the recent-projects grid and the saved-templates grid.
// Reuses the existing grids verbatim (ProjectsGrid + embedded MyTemplates) so
// the tiles, lightbox, and actions stay identical to /projects and /templates.

import { useLayoutEffect, useRef, useState } from "react";
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
  viewerIsAdmin = false,
}: {
  projects: ProjectsGridProject[];
  templates: MyTemplatesTemplate[];
  // Admins can delete any template from the widget's grid.
  viewerIsAdmin?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("templates");
  const dict = useDict();
  const { locale } = useLocale();

  // §24: on the dashboard <body> is the scroll container. Swapping the (tall)
  // projects grid for the (short) templates grid collapses page height, so the
  // browser clamps / anchor-resets scrollTop upward and the page appears to
  // "jump to top" on toggle. Capture the offset before the swap and restore it
  // right after the DOM updates so the library header stays put.
  const savedScroll = useRef<number | null>(null);
  const changeTab = (next: Tab) => {
    savedScroll.current =
      document.body.scrollTop || document.documentElement.scrollTop;
    setTab(next);
  };
  useLayoutEffect(() => {
    if (savedScroll.current == null) return;
    document.body.scrollTop = savedScroll.current;
    document.documentElement.scrollTop = savedScroll.current;
    savedScroll.current = null;
  }, [tab]);

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <SegmentedToggle<Tab>
          options={[
            { value: "projects", label: dict.nav.projects },
            { value: "templates", label: dict.nav.templates },
          ]}
          value={tab}
          onChange={changeTab}
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
          // Match the templates grid (MyTemplates) exactly so the two toggle
          // tabs render as one coherent widget — one tile per row on phones,
          // widening in lockstep to 5-up on desktop.
          gridClassName="grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
          emptyState={
            <p className="py-10 text-center text-sm text-muted">
              {dict.homeLibrary.noProjects}
            </p>
          }
        />
      ) : (
        <MyTemplates templates={templates} viewerIsAdmin={viewerIsAdmin} embedded />
      )}
    </div>
  );
}
