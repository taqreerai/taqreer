"use client";

// Client island for /free-stock-images: search-by-prompt + orientation
// filter + 3-column CSS masonry + numbered pagination. Seeded with the
// server's first page (so the initial HTML is crawlable and paints
// instantly); every interaction goes through /api/stock-images.
//
// Tiles lazy-load (loading="lazy") and each reserves its aspect box up
// front (StockImageCard), so the masonry never reflows as images resolve.
//
// Search/filter/page fetch imperatively from their handlers (the repo's
// set-state-in-effect rule bans deriving state in a mount effect). Search
// is debounced via a timeout ref; a request-id ref drops stale responses
// so fast typing / quick page clicks can't render an out-of-order page.

import { useRef, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { SegmentedToggle } from "@/components/create/controls";
import { Pagination } from "@/components/app/Pagination";
import { StockImageCard } from "@/components/marketing/StockImageCard";
import { StockImageModal } from "@/components/marketing/StockImageModal";
import type { StockImage } from "@/lib/stock-images/query";

type RatioValue = "all" | "landscape" | "portrait";

export function StockImagesClient({
  initialImages,
  initialPageCount,
}: {
  initialImages: StockImage[];
  initialPageCount: number;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.stockImages;

  const [search, setSearch] = useState("");
  const [ratio, setRatio] = useState<RatioValue>("all");
  const [images, setImages] = useState<StockImage[]>(initialImages);
  const [pageCount, setPageCount] = useState(initialPageCount);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  // True once the user has narrowed the set (search or filter) — drives
  // the "no results" vs "empty library" copy.
  const [filtered, setFiltered] = useState(false);
  // Lightbox target (null = closed).
  const [modalImage, setModalImage] = useState<StockImage | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic id: every fetch bumps it; a response is applied only if it
  // still matches (drops stale/out-of-order results).
  const reqIdRef = useRef(0);
  // Scroll target so a page change returns to the top of the grid, not
  // the top of the hero.
  const gridTopRef = useRef<HTMLDivElement | null>(null);

  const ratioOptions: ReadonlyArray<{
    value: RatioValue;
    label: string;
    icon?: string;
  }> = [
    { value: "all", label: t.filterAll },
    { value: "landscape", label: t.filterLandscape },
    { value: "portrait", label: t.filterPortrait },
  ];

  function buildUrl(q: string, r: RatioValue, p: number): string {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (r !== "all") params.set("ratio", r);
    if (p > 0) params.set("page", String(p));
    return `/api/stock-images?${params.toString()}`;
  }

  // Race-guarded fetch for a given query + page.
  async function runQuery(q: string, r: RatioValue, targetPage: number) {
    const id = ++reqIdRef.current;
    setLoading(true);
    setFiltered(q.trim().length > 0 || r !== "all");
    try {
      // no-store: never reuse the browser's cached copy for an
      // interaction — filter/page results must reflect fresh server
      // state. The CDN edge cache (from the API's response headers) still
      // serves anonymous first loads.
      const res = await fetch(buildUrl(q, r, targetPage), { cache: "no-store" });
      // A non-2xx body (e.g. { error }) still parses as JSON, so guard the
      // status AND the shape before trusting it — otherwise `images` could
      // become undefined and crash at `images.length`.
      if (!res.ok) throw new Error(`stock-images ${res.status}`);
      const data = (await res.json()) as {
        images: StockImage[];
        pageCount: number;
        page: number;
      };
      if (
        !Array.isArray(data.images) ||
        !Number.isFinite(data.pageCount) ||
        !Number.isFinite(data.page)
      ) {
        throw new Error("invalid stock-images response");
      }
      if (id !== reqIdRef.current) return; // superseded
      setImages(data.images);
      setPageCount(data.pageCount);
      setPage(data.page);
    } catch {
      // Keep the last successful page on failure (don't blank the gallery on
      // a transient error); just release the loading state in `finally`.
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runQuery(value, ratio, 0), 300);
  }

  function handleRatio(value: RatioValue) {
    setRatio(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    runQuery(search, value, 0);
  }

  function handlePage(next: number) {
    runQuery(search, ratio, next);
    gridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      {/* Anchor for "scroll back to the grid" on page change. */}
      <div ref={gridTopRef} className="scroll-mt-28" />

      {/* Controls row: search on the start side, orientation filter on the end. */}
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3" dir={dir}>
        <div className="max-w-xs min-w-[200px] flex-1">
          <label htmlFor="stock-search" className="sr-only">
            {t.searchLabel}
          </label>
          {/* Canonical design-system field: plain .input-dark (theme-aware,
              carries its own pill radius + padding), per /ar/brand §09.
              type="text" — not "search" — so no native browser clear button. */}
          <input
            id="stock-search"
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="input-dark w-full text-sm"
          />
        </div>

        <div className="ms-auto">
          <SegmentedToggle
            options={ratioOptions}
            value={ratio}
            onChange={handleRatio}
            ariaLabel={t.filterAria}
            size="comfortable"
          />
        </div>
      </div>

      {images.length === 0 ? (
        <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
            {filtered ? "search_off" : "photo_library"}
          </span>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            {filtered ? t.noResultsTitle : t.emptyTitle}
          </h2>
          <p className="max-w-[320px] text-sm leading-7 text-muted">
            {filtered ? t.noResultsDesc : t.emptyDesc}
          </p>
        </div>
      ) : (
        <>
          {/* CSS multi-column masonry, capped at 3 columns. Tiles keep
              their natural aspect and flow into columns (real Unsplash
              wall). RTL flips column order via the ancestor dir. */}
          <div
            className={`columns-2 gap-4 md:columns-3 ${
              loading ? "opacity-60 transition-opacity" : ""
            }`}
          >
            {images.map((img) => (
              <div key={img.id} className="mb-4 break-inside-avoid">
                <StockImageCard image={img} onOpen={setModalImage} />
              </div>
            ))}
          </div>

          <Pagination page={page} pageCount={pageCount} onChange={handlePage} />
        </>
      )}

      <StockImageModal
        image={modalImage}
        onClose={() => setModalImage(null)}
      />
    </div>
  );
}
