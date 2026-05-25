// Generic utility helpers.
//
// `cn`, `formatDate`, and `truncate` were removed 2026-05-25 in the
// dead-code audit pass — zero importers across the app. The
// associated `clsx` + `tailwind-merge` deps were also dropped. If a
// future surface needs the canonical Tailwind-class merge helper,
// reintroduce them then; for now we'd rather not carry unused
// exports + their npm dependencies.

/**
 * UTC start of the current calendar month. Used by usage / quota
 * routes to bound "this month's runs so far" queries.
 */
export function getStartOfMonthUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
