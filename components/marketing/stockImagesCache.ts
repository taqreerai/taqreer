"use client";

// Client-side cache for the lightbox's "more from this set" deck groups.
//
// Why: the group is fetched lazily when the modal opens, so it used to pop in
// a beat late — and because the suggestions sit BELOW the download inside the
// bottom-pinned group, their arrival shoved the download button up. Prefetching
// on tile hover/focus means the data is already here by the time the modal
// opens, so it renders on the first paint with no shift.
//
// Deliberately a plain module-level Map, not React state: it's a cross-render,
// cross-component cache whose only job is "have I already fetched this id?".
// Responses are public + edge-cached, so no `no-store` here — a warm browser/
// CDN hit is exactly what makes the prefetch cheap.

import type { StockImage } from "@/lib/stock-images/query";

const cache = new Map<string, StockImage[]>();
const inFlight = new Map<string, Promise<void>>();

/** The deck group for `id`, if it's already been fetched. */
export function getCachedRelated(id: string): StockImage[] | undefined {
  return cache.get(id);
}

/**
 * Warm the cache for `id`. Safe to call repeatedly (hover fires a lot): a
 * cached or in-flight id is a no-op. Never throws — suggestions are optional.
 * Returns the in-flight promise so a caller can react when it lands.
 */
export function prefetchRelated(id: string): Promise<void> {
  if (!id || cache.has(id)) return Promise.resolve();
  const existing = inFlight.get(id);
  if (existing) return existing;

  const p = fetch(`/api/stock-images/related?id=${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { images?: StockImage[] } | null) => {
      if (d && Array.isArray(d.images)) cache.set(id, d.images);
    })
    .catch(() => {
      /* optional data — a failure just means no suggestions */
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, p);
  return p;
}
