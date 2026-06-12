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

import { useMemo, useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
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
import {
  COLOR_BUCKETS,
  bucketize,
} from "@/lib/project/derive-color-tags";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";

// 5 columns × 3 rows = 15 tiles per page. The grid component sets
// the breakpoint at lg:grid-cols-5; on smaller viewports the grid
// drops to 4/3/2 cols but the page size stays 15 — keeps the
// pagination boundaries identical across breakpoints so the
// current-page UX doesn't shift when a user resizes their window.
const PAGE_SIZE = 15;

// Server passes the same shape as ProjectsGridProject + the filter
// columns the page needs but the grid doesn't (language for the
// language pills, colorTags for the swatch picker). Kept as an
// extended type so the grid's contract stays minimal.
// `dominantColor` is included for legacy reasons; the canonical
// swatch source is `colorTags` (post 2026-05-21 — handles
// greyscale-only decks and multi-accent palettes correctly).
export type ProjectsPageProject = ProjectsGridProject & {
  language: string;
  dominantColor: string | null;
  colorTags: string[];
};

export function ProjectsPageClient({
  projects,
}: {
  projects: ProjectsPageProject[];
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.pages.projects;
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
  // Optimistic-delete tracking lives here (NOT inside ProjectsGrid)
  // so the filter runs BEFORE the pagination slice — without this
  // ordering deleting a tile would leave a hole on the current
  // page instead of the 16th project sliding up into view.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  // Recovers from the save → navigate-too-fast race: if any project
  // has no thumbnails yet, schedule router.refresh() at 3 s and 8 s
  // to pick up the Inngest job's eventual write. Scoped to the
  // FULL projects list, not just the current page, so the user is
  // covered even if their recent save happens to land on page 2.
  useRefreshWhileThumbnailsPending(projects);

  // Bucketed swatch list. Each `colorTags` entry expands to 1-2
  // canonical buckets via `bucketize` (returns multiple for colors
  // near a hue boundary — perceptual overlap). The strip renders
  // only the buckets actually present in the user's library, in
  // canonical rainbow order.
  const swatchColors = useMemo(() => {
    const present = new Set<string>();
    for (const p of projects) {
      for (const hex of p.colorTags ?? []) {
        if (!hex) continue;
        for (const bucket of bucketize(hex)) {
          present.add(bucket);
        }
      }
    }
    return COLOR_BUCKETS.filter((b) => present.has(b));
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (deletedIds.has(p.id)) return false;
      if (format !== null && p.format !== format) return false;
      if (language !== null && p.language !== language) return false;
      if (favOnly && !p.isFavorite) return false;
      // Color filter — a deck matches if ANY of its colorTags
      // perceptually belongs to the selected bucket. `bucketize`
      // returns 1-2 buckets per hex (boundary colours land in
      // both adjacent ones), so a deck with `#630EE1` (h=264,
      // blue-purple) matches the filter under EITHER blue OR
      // purple — same as how a human perceives it.
      if (
        colorHex &&
        !(p.colorTags ?? []).some((t) => bucketize(t).includes(colorHex))
      ) {
        return false;
      }
      if (q && !p.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, deletedIds, search, format, language, favOnly, colorHex]);

  // Filter change → reset to page 0. Wired through per-filter
  // handlers (not a useEffect) because `setState` inside an effect
  // trips `react-hooks/set-state-in-effect` — a CI hard fail. Same
  // pattern applied to TemplatesPageClient (CR finding 2026-05-22).
  // Matches user mental model "I changed a filter → start at the top."
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleFormatChange = (value: FormatFilter) => {
    setFormat(value);
    setPage(0);
  };
  const handleLanguageChange = (value: LanguageFilter) => {
    setLanguage(value);
    setPage(0);
  };
  const handleFavOnlyChange = (value: boolean) => {
    setFavOnly(value);
    setPage(0);
  };
  const handleColorChange = (value: string | null) => {
    setColorHex(value);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp the page index when the filtered list shrinks (derived
  // value during render, not a setState in an effect — earlier
  // attempt tripped `react-hooks/set-state-in-effect` per CR
  // 2026-05-21). Without the clamp, deleting items from the last
  // page leaves the user on a now-empty page even though earlier
  // pages still have content.
  const activePage = Math.max(0, Math.min(page, pageCount - 1));
  const paginated = useMemo(
    () =>
      filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE),
    [filtered, activePage],
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
    setPage(0);
  };

  return (
    <>
      <ProjectsFilterBar
        search={search}
        onSearchChange={handleSearchChange}
        format={format}
        onFormatChange={handleFormatChange}
        language={language}
        onLanguageChange={handleLanguageChange}
        favOnly={favOnly}
        onFavOnlyChange={handleFavOnlyChange}
        swatchColors={swatchColors}
        selectedColor={colorHex}
        onColorChange={handleColorChange}
      />
      <ProjectsGrid
        projects={paginated}
        padTo={PAGE_SIZE}
        // ONLY page changes trigger the staggered fade cascade.
        // Filter / search changes use Framer's `layout` prop on
        // each tile for smooth position transitions — but that
        // only works if tiles STAY MOUNTED across the render
        // (stable `key={projectId}`). A composite key that
        // remounts the outer wrapper on every filter click kills
        // the layout animation (no "before" position to animate
        // from). Pagination is the only operation where the entire
        // page-worth of tiles is fresh content, so the cascade
        // there is correct.
        staggerKey={activePage}
        gridClassName="grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        onDeleted={(id) =>
          setDeletedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          })
        }
        emptyState={
          projects.length === 0 ? (
            // True empty — user has no projects yet. Funnel to /create.
            <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                folder_open
              </span>
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {t.emptyTitle}
              </h3>
              <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
                {t.emptyDesc}
              </p>
              <Link
                className="btn-gradient inline-block px-4 py-1.5 text-xs no-underline"
                href={localizedHref("/create", locale)}
              >
                {t.createProject}
              </Link>
            </div>
          ) : (
            // Filtered to zero — projects exist but the active filters
            // hide them all. Offer a reset rather than a /create CTA.
            <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                filter_alt_off
              </span>
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {t.noResultsTitle}
              </h3>
              <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
                {t.noResultsDesc}
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="btn-pill px-4 py-1.5 text-xs"
                disabled={!filtersActive}
              >
                {t.resetFilters}
              </button>
            </div>
          )
        }
      />
      <Pagination page={activePage} pageCount={pageCount} onChange={setPage} />
    </>
  );
}
