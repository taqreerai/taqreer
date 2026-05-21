"use client";

// Filter + grid wrapper for /projects. Owns:
//   • filter state (format, language, favorited, search query, color)
//   • in-memory filtering of the SSR'd projects array
//   • the differentiated empty state (no data yet vs filtered to
//     nothing) — picked based on whether ANY filter is active.
//
// Filters are client-side for v1; the page-level prop is the
// canonical "all projects" list and we never re-fetch. Trade-off
// noted in page.tsx — URL state is a v2 add.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ProjectsGrid,
  type ProjectsGridProject,
} from "@/components/app/ProjectsGrid";
import {
  ProjectsFilterBar,
  type FormatFilter,
  type LanguageFilter,
} from "@/components/app/ProjectsFilterBar";
import { Pagination } from "@/components/app/Pagination";

// 5 columns × 3 rows = 15 tiles per page. The grid component sets
// the breakpoint at lg:grid-cols-5; on smaller viewports the grid
// drops to 4/3/2 cols but the page size stays 15 — keeps the
// pagination boundaries identical across breakpoints so the
// current-page UX doesn't shift when a user resizes their window.
const PAGE_SIZE = 15;

// Server passes the same shape as ProjectsGridProject + the two
// filter columns (`language`, `dominantColor`). Kept as an extended
// type so the grid component's contract stays minimal.
export type ProjectsPageProject = ProjectsGridProject & {
  language: string;
  dominantColor: string | null;
};

export function ProjectsPageClient({
  projects,
}: {
  projects: ProjectsPageProject[];
}) {
  const [search, setSearch] = useState("");
  // null = no filter active on this dimension. Single non-null value
  // = filter to that one option. Chip clicks toggle between null and
  // the option (click active → null; click idle → option).
  const [format, setFormat] = useState<FormatFilter>(null);
  const [language, setLanguage] = useState<LanguageFilter>(null);
  const [favOnly, setFavOnly] = useState(false);
  // Selected hex value (exact match) or null for "any". v1 uses
  // exact-hex filtering — the swatch picker shows the user's
  // actual dominantColor values, so an exact match always lands on
  // something visible. Fuzzy / hue-bucket matching is a v2 upgrade.
  const [colorHex, setColorHex] = useState<string | null>(null);
  // Zero-indexed current page. Reset to 0 whenever filters change
  // (effect below) so the user lands on the first slice of the
  // newly-filtered set, not page-N-of-the-old-result-set.
  const [page, setPage] = useState(0);

  // Distinct dominantColor values across the user's deck library,
  // sorted by frequency desc → most-used colours appear first in
  // the swatch strip. `null` / empty colours skipped — pre-frozen
  // projects (created before step 8b's dominantColor freeze)
  // shouldn't pollute the picker.
  const swatchColors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const c = p.dominantColor?.trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([hex]) => hex);
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (format !== null && p.format !== format) return false;
      if (language !== null && p.language !== language) return false;
      if (favOnly && !p.isFavorite) return false;
      if (colorHex && p.dominantColor !== colorHex) return false;
      if (q && !p.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, search, format, language, favOnly, colorHex]);

  // Filter change → reset to page 0. Without this a user on page 4
  // would stay on a now-empty offset after narrowing the set; the
  // empty-state copy would fire incorrectly. Watching the filter
  // primitives (not `filtered.length`) so toggling a filter that
  // happens to leave the count unchanged still resets — matches
  // user mental model "I changed a filter → start at the top."
  useEffect(() => {
    setPage(0);
  }, [search, format, language, favOnly, colorHex]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page],
  );

  const filtersActive =
    search.trim().length > 0 ||
    format !== null ||
    language !== null ||
    favOnly ||
    colorHex !== null;

  const resetFilters = () => {
    setSearch("");
    setFormat(null);
    setLanguage(null);
    setFavOnly(false);
    setColorHex(null);
  };

  return (
    <>
      <ProjectsFilterBar
        search={search}
        onSearchChange={setSearch}
        format={format}
        onFormatChange={setFormat}
        language={language}
        onLanguageChange={setLanguage}
        favOnly={favOnly}
        onFavOnlyChange={setFavOnly}
        swatchColors={swatchColors}
        selectedColor={colorHex}
        onColorChange={setColorHex}
      />
      <ProjectsGrid
        projects={paginated}
        padTo={PAGE_SIZE}
        gridClassName="grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        emptyState={
          projects.length === 0 ? (
            // True empty — user has no projects yet. Funnel to /create.
            <div className="glass-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                folder_open
              </span>
              <h3 className="mb-2 text-base font-semibold text-white">
                لا توجد مشاريع بعد
              </h3>
              <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
                ابدأ بإنشاء أول عرض تقديمي وسيظهر هنا فور حفظه.
              </p>
              <Link
                className="btn-gradient inline-block px-4 py-1.5 text-xs no-underline"
                href="/create"
              >
                إنشاء مشروع
              </Link>
            </div>
          ) : (
            // Filtered to zero — projects exist but the active filters
            // hide them all. Offer a reset rather than a /create CTA.
            <div className="glass-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                filter_alt_off
              </span>
              <h3 className="mb-2 text-base font-semibold text-white">
                لا توجد نتائج تطابق الفلاتر
              </h3>
              <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
                جرّب تخفيف الفلاتر أو إعادة التعيين لعرض كل المشاريع.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="btn-pill px-4 py-1.5 text-xs"
                disabled={!filtersActive}
              >
                إعادة تعيين الفلاتر
              </button>
            </div>
          )
        }
      />
      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </>
  );
}
