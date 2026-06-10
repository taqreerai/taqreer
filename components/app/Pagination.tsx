"use client";

// Pill-style page controls. Layout (RTL-aware via `dir="rtl"` on
// the outer nav):
//   [prev]  [1] [2] [3] … [N]  [next]
//
// Logical, not visual — "prev" means "older page index", which in
// RTL maps to a rightward chevron (backward in reading direction).
// Material Symbols glyphs don't auto-flip, so the icons are picked
// explicitly: chevron_right = prev, chevron_left = next in this
// RTL chrome.
//
// Number window: shows every page when total ≤ 7; otherwise
// compresses with ellipsis around the current page:
//   1 … 4 5 6 … 12
// Designed for typical user libraries (10-100 items, 1-7 pages);
// degrades gracefully past that without horizontal scroll.
//
// Auto-hides when `totalPages <= 1` — callers can mount it
// unconditionally; nothing renders if there's a single page.

import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

type Props = {
  page: number; // zero-indexed
  pageCount: number;
  onChange: (next: number) => void;
};

// Compute the page tokens to render (numbers + ellipsis sentinels).
// Always include 0 and pageCount-1. Window 1 page on each side of
// `current`. Insert "…" between non-contiguous segments. Returned
// items are either `{ kind: "page", n }` or `{ kind: "ellipsis" }`.
type Token =
  | { kind: "page"; n: number }
  | { kind: "ellipsis"; key: string };

function buildTokens(page: number, pageCount: number): Token[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, n) => ({ kind: "page", n }));
  }
  const set = new Set<number>([0, pageCount - 1, page, page - 1, page + 1]);
  // Always include 1 and pageCount-2 so neighbours of edge pages
  // don't produce 1-page jumps via ellipsis (avoids "1 … 2 3"
  // which looks broken).
  set.add(1);
  set.add(pageCount - 2);
  const sorted = Array.from(set)
    .filter((n) => n >= 0 && n < pageCount)
    .sort((a, b) => a - b);
  const out: Token[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    out.push({ kind: "page", n });
    const next = sorted[i + 1];
    if (next !== undefined && next - n > 1) {
      out.push({ kind: "ellipsis", key: `e-${n}-${next}` });
    }
  }
  return out;
}

export function Pagination({ page, pageCount, onChange }: Props) {
  const dict = useDict();
  const { dir } = useLocale();
  if (pageCount <= 1) return null;
  const tokens = buildTokens(page, pageCount);
  const atStart = page === 0;
  const atEnd = page === pageCount - 1;

  return (
    <nav
      aria-label={dict.components.pagination.aria}
      dir={dir}
      className="mt-10 flex items-center justify-center gap-2"
    >
      <button
        type="button"
        aria-label={dict.components.pagination.previousPage}
        onClick={() => onChange(page - 1)}
        disabled={atStart}
        className="btn-pill inline-flex h-8 w-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">
          chevron_right
        </span>
      </button>

      {tokens.map((t) => {
        if (t.kind === "ellipsis") {
          return (
            <span
              key={t.key}
              aria-hidden
              className="px-1 text-xs text-muted select-none"
            >
              …
            </span>
          );
        }
        const isCurrent = t.n === page;
        return (
          <button
            key={t.n}
            type="button"
            aria-label={dict.components.pagination.pageN.replace("{n}", String(t.n + 1))}
            aria-current={isCurrent ? "page" : undefined}
            onClick={() => onChange(t.n)}
            // Active page wears the `btn-gradient` CTA recipe so the
            // current location reads as a primary state; idle pages
            // use `btn-pill` for the secondary glass surface.
            className={`${
              isCurrent ? "btn-gradient" : "btn-pill"
            } inline-flex h-8 min-w-8 items-center justify-center px-2 text-xs`}
          >
            {t.n + 1}
          </button>
        );
      })}

      <button
        type="button"
        aria-label={dict.components.pagination.nextPage}
        onClick={() => onChange(page + 1)}
        disabled={atEnd}
        className="btn-pill inline-flex h-8 w-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">
          chevron_left
        </span>
      </button>
    </nav>
  );
}
