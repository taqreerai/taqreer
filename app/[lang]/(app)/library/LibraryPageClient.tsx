"use client";

// /library client — the user's generated images, in the same grid +
// pagination shape as /projects (aspect-video tiles, 15 per page,
// lg:grid-cols-5).
//
// Controls (one row): search-by-project on the start side, a date/name
// sort toggle pushed to the end (visual left in RTL). Both are
// in-memory (instant, no URL roundtrip). Clicking a tile opens the
// expand modal (LibraryImageModal) with a download CTA.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { Pagination } from "@/components/app/Pagination";
import { SegmentedToggle } from "@/components/create/controls";
import { LibraryImageCard } from "@/components/app/LibraryImageCard";
import { LibraryImageModal } from "@/components/app/LibraryImageModal";

export type { LibraryImage } from "@/components/app/LibraryImageCard";
import type { LibraryImage } from "@/components/app/LibraryImageCard";

// Match /projects: 15 per page (3 full rows at lg:grid-cols-5).
const PAGE_SIZE = 15;

type SortKey = "date" | "name";

export function LibraryPageClient({ images }: { images: LibraryImage[] }) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.pages.library;
  const sortOptions: ReadonlyArray<{ value: SortKey; label: string }> = [
    { value: "date", label: t.sortRecent },
    { value: "name", label: t.sortName },
  ];

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [page, setPage] = useState(0);
  // Expand-modal target: index into `visible`. null = closed. (Index,
  // not the image, so the modal's prev/next can walk the whole list.)
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? images.filter((img) => img.projectTitle.toLowerCase().includes(q))
      : images.slice();
    list.sort((a, b) =>
      sort === "name"
        ? a.projectTitle.localeCompare(b.projectTitle, "ar") ||
          b.createdAt.localeCompare(a.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
    return list;
  }, [images, search, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const activePage = Math.max(0, Math.min(page, pageCount - 1));
  const paginated = useMemo(
    () => visible.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE),
    [visible, activePage],
  );

  // Control change → page 0 (per-handler reset, not a useEffect — the
  // `react-hooks/set-state-in-effect` rule is a CI hard-fail; same
  // pattern as /projects + /templates).
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleSort = (value: SortKey) => {
    setSort(value);
    setPage(0);
  };

  return (
    <div className="page-container">
      <header className="mb-8">
        <h1 className="tq-h1">{t.title}</h1>
        <p className="tq-subhead">{t.subtitle}</p>
      </header>

      {images.length === 0 ? (
        <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
            photo_library
          </span>
          <h3 className="mb-2 text-base font-semibold text-foreground">
            {t.emptyTitle}
          </h3>
          <p className="mb-5 max-w-[320px] text-sm leading-7 text-muted">
            {t.emptyDesc}
          </p>
          <Link
            className="btn-gradient inline-block px-4 py-1.5 text-xs no-underline"
            href="/create"
          >
            {t.createDeck}
          </Link>
        </div>
      ) : (
        <>
          <div
            className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3"
            dir={dir}
          >
            <div className="relative max-w-xs min-w-[200px] flex-1">
              <span
                aria-hidden
                className="material-symbols-outlined pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[18px] text-muted"
              >
                search
              </span>
              <label htmlFor="lib-search" className="sr-only">
                {t.searchLabel}
              </label>
              <input
                id="lib-search"
                type="search"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="input-search w-full rounded-full px-4 py-2 pe-10 text-sm"
              />
            </div>

            {/* Sort pushed to the visual-left (end) side, same row. */}
            <div className="ms-auto flex items-center gap-2">
              <span className="text-xs text-muted">{t.sortBy}</span>
              <SegmentedToggle
                options={sortOptions}
                value={sort}
                onChange={handleSort}
                ariaLabel={t.sortAria}
                size="comfortable"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="surface-empty-state flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="material-symbols-outlined mb-4 text-[42px] text-muted/40">
                search_off
              </span>
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {t.noResultsTitle}
              </h3>
              <p className="max-w-[320px] text-sm leading-7 text-muted">
                {t.noResultsDesc}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {paginated.map((img) => (
                  // `layout` animates each tile to its new position when the
                  // rendered set reorders (sort) or narrows (search) — the
                  // same Framer pattern as ProjectsGrid. The stable `img.id`
                  // key is what lets Framer track each tile across the move
                  // (and would animate the backfill on delete, if/when the
                  // library gets a delete action).
                  <motion.div key={img.id} layout>
                    <LibraryImageCard
                      image={img}
                      onOpen={(img) =>
                        setOpenIndex(visible.findIndex((i) => i.id === img.id))
                      }
                    />
                  </motion.div>
                ))}
              </div>
              <Pagination
                page={activePage}
                pageCount={pageCount}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}

      <LibraryImageModal
        open={openIndex !== null}
        images={visible}
        initialIndex={openIndex ?? 0}
        onClose={() => setOpenIndex(null)}
      />
    </div>
  );
}
