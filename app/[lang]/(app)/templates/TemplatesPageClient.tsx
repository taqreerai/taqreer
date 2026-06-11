"use client";

// Filter + grid + lightbox wrapper for /templates.
//
// Mirrors ProjectsPageClient's shape — same filter state model, same
// in-memory filter pipeline, same 5-column grid + pagination + empty-
// state split — with two domain swaps:
//
//   • "favOnly" boolean → "owner" 3-value enum (own / community / all).
//   • Click target → TemplateLightbox (no per-template detail route).
//
// Filters are client-side for v1; the page-level prop is the
// canonical "all visible templates" list (own + community, deduped)
// and we never re-fetch.

import { useMemo, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { TemplatesGrid } from "@/components/app/TemplatesGrid";
import {
  TemplatesFilterBar,
  type FormatFilter,
  type LanguageFilter,
  type OwnerFilter,
} from "@/components/app/TemplatesFilterBar";
import { TemplateLightbox } from "@/components/app/TemplateLightbox";
import { Pagination } from "@/components/app/Pagination";
import {
  COLOR_BUCKETS,
  bucketize,
} from "@/lib/project/derive-color-tags";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";
import {
  prepareTemplateUse,
  redirectToPricingIfGated,
} from "@/lib/mimic/template-seed";
import type { SlideFormat } from "@/lib/schema/slide";
import type { TemplateForBrowse } from "./types";

// Same page size as /projects so the visual rhythm and pagination
// boundaries feel identical between the two library surfaces.
const PAGE_SIZE = 15;

export function TemplatesPageClient({
  templates,
  ownCount,
  communityCount,
}: {
  templates: TemplateForBrowse[];
  ownCount: number;
  communityCount: number;
}) {
  const dict = useDict();
  const t = dict.pages.templates;
  // Schedule router.refresh() at ~3s/~8s after the first pending tile
  // appears so freshly-saved templates pick up their showcase PNGs
  // without a manual reload. Hook is shared with /projects, /favorites,
  // and the dashboard widget — same lifecycle, same timing.
  useRefreshWhileThumbnailsPending(templates);

  const [format, setFormat] = useState<FormatFilter>(null);
  const [language, setLanguage] = useState<LanguageFilter>(null);
  // Default: own. Most-common landing intent is "see my own work".
  const [owner, setOwner] = useState<OwnerFilter>("own");
  const [colorHex, setColorHex] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // Lightbox target. null = closed. Drives both TemplateLightbox
  // `open` and the slides/format props.
  const [preview, setPreview] = useState<TemplateForBrowse | null>(null);
  // "Use this template" busy gate — blocks double-clicks while the
  // seed request is in flight. Cleared either by a successful
  // navigation (no need; the page unmounts) or by the catch on
  // failure (releases the gate so the user can retry).
  const [useBusy, setUseBusy] = useState(false);

  const handleUseTemplate = async () => {
    if (!preview || useBusy) return;
    setUseBusy(true);
    try {
      // Prepare the Mimic reference while the lightbox CTA shows its
      // busy spinner, then hard-navigate to the forked flow (which
      // reads the cache → no full-screen loader).
      await prepareTemplateUse("template", preview.id);
      window.location.assign(`/use-template/${preview.id}`);
    } catch (err) {
      // 402 = premium template, user isn't on Pro → route to pricing.
      if (redirectToPricingIfGated(err)) return;
      console.warn("[TemplatesPageClient] use prep failed", err);
      setUseBusy(false);
    }
  };

  // Bucketed swatches across every visible template. Each palette
  // entry expands to 1-2 buckets via `bucketize` (boundary hex values
  // map to two adjacent buckets — same perceptual-overlap rule
  // /projects uses for colorTags). We compute over the FULL templates
  // list (not just the current owner-filter slice) so toggling the
  // owner chip doesn't make the swatch row reshuffle/jump.
  const swatchColors = useMemo(() => {
    const present = new Set<string>();
    for (const t of templates) {
      for (const hex of t.brand.palette ?? []) {
        if (!hex) continue;
        for (const bucket of bucketize(hex)) {
          present.add(bucket);
        }
      }
    }
    return COLOR_BUCKETS.filter((b) => present.has(b));
  }, [templates]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (owner === "own" && !t.isMine) return false;
      if (owner === "community" && t.isMine) return false;
      // owner === "all" → no owner filter
      if (format !== null && t.brand.format !== format) return false;
      if (language !== null && t.language !== language) return false;
      if (
        colorHex &&
        !(t.brand.palette ?? []).some((hex) => bucketize(hex).includes(colorHex))
      ) {
        return false;
      }
      return true;
    });
  }, [templates, format, language, owner, colorHex]);

  // Filter change → page 0. Driven by per-handler resets instead of
  // a useEffect because `setState` inside an effect trips the
  // `react-hooks/set-state-in-effect` rule (CR finding #2) — a CI
  // hard fail. The page-clamp at line 108 still guards against
  // shrinking filtered counts (e.g. after delete).
  const handleFormatChange = (value: FormatFilter) => {
    setFormat(value);
    setPage(0);
  };
  const handleLanguageChange = (value: LanguageFilter) => {
    setLanguage(value);
    setPage(0);
  };
  const handleOwnerChange = (value: OwnerFilter) => {
    setOwner(value);
    setPage(0);
  };
  const handleColorChange = (value: string | null) => {
    setColorHex(value);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.max(0, Math.min(page, pageCount - 1));
  const paginated = useMemo(
    () =>
      filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE),
    [filtered, activePage],
  );

  const filtersActive =
    format !== null ||
    language !== null ||
    owner !== "own" ||
    colorHex !== null;

  const resetFilters = () => {
    setFormat(null);
    setLanguage(null);
    setOwner("own");
    setColorHex(null);
    setPage(0);
  };

  const previewFormat: SlideFormat =
    preview?.brand.format === "9:16" ? "9:16" : "16:9";

  return (
    <>
      <div className="page-container">
        <header className="mb-8">
          <h1 className="tq-h1">{t.title}</h1>
          <p className="tq-subhead">{t.subtitle}</p>
        </header>

        <TemplatesFilterBar
          format={format}
          onFormatChange={handleFormatChange}
          language={language}
          onLanguageChange={handleLanguageChange}
          owner={owner}
          onOwnerChange={handleOwnerChange}
          ownCount={ownCount}
          communityCount={communityCount}
          swatchColors={swatchColors}
          selectedColor={colorHex}
          onColorChange={handleColorChange}
        />

        <TemplatesGrid
          templates={paginated}
          padTo={PAGE_SIZE}
          staggerKey={activePage}
          gridClassName="grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          onOpen={setPreview}
          emptyState={
            templates.length === 0 ? (
              // True empty — user has no templates AND community is
              // empty. Steer them toward saving one.
              <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
                <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                  dashboard_customize
                </span>
                <h3 className="mb-2 text-base font-semibold text-foreground">
                  {t.emptyTitle}
                </h3>
                <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
                  {t.emptyDesc}
                </p>
              </div>
            ) : (
              // Filtered to zero — templates exist but the active
              // filters hide them all.
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
      </div>

      <TemplateLightbox
        open={!!preview}
        slides={preview?.thumbnailUrls ?? []}
        format={previewFormat}
        isPremium={preview?.isPremium ?? false}
        onClose={() => setPreview(null)}
        onUseTemplate={preview ? handleUseTemplate : undefined}
        useBusy={useBusy}
      />
    </>
  );
}
