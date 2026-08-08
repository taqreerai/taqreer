"use client";

// Live generated-image fills (context/images.md async fill).
//
// Maps `data-genid` → public image URL. SlideRenderer reads this and
// injects each reserved box's <img src> BEFORE sanitising, so a box
// swaps its shimmer placeholder → the real image the moment the
// `slide.image.ready` broadcast lands — live, while the deck is still
// streaming.
//
// Default empty: a SlideRenderer used OUTSIDE a provider (PDF/PPTX/PNG
// export, template showcase, a standalone thumbnail) just renders the
// saved HTML, which already carries the reconciled src once the deck
// finishes. So this context is purely additive — no provider, no-op.

import { createContext, useContext } from "react";

export type GenImageFills = Record<string, string>;

const GenImageContext = createContext<GenImageFills>({});

export const GenImageProvider = GenImageContext.Provider;

export function useGenImageFills(): GenImageFills {
  return useContext(GenImageContext);
}

// Genids whose generation FAILED permanently (safety/copyright rejection —
// `slide.image.failed` broadcast + the status route's `imageFailed`).
// SlideRenderer marks the matching boxes `.tq-genimg-failed` so the shimmer
// stops lying about "loading". Additive like the fills context: no provider
// (exports, thumbnails, showcases) → empty set → no-op.
const EMPTY_FAILED: ReadonlySet<string> = new Set();

const GenImageFailedContext = createContext<ReadonlySet<string>>(EMPTY_FAILED);

export const GenImageFailedProvider = GenImageFailedContext.Provider;

export function useGenImageFailed(): ReadonlySet<string> {
  return useContext(GenImageFailedContext);
}

// Genids whose fill is still IN FLIGHT server-side (a GeneratedImage row in
// `pending` / `generating` — the status route's `imagePending`). SlideRenderer
// marks the matching srcless boxes `.tq-genimg-live` so they keep the loading
// shimmer through the post-stream fill window (the deck completes BEFORE
// deck-images-generate reconciles; without this the box flashed the static
// placeholder glyph mid-fill, regression report 2026-08-09).
//
// `null` means "no server verdict yet": DeckView provides null until the fill
// poll's first response, and SlideRenderer then treats EVERY srcless box as
// in-flight — the honest default while the seed/poll gap is open. The context
// DEFAULT is the empty set, not null: a SlideRenderer outside a provider
// (exports, template showcase, standalone thumbnails) must render orphaned
// boxes as the static glyph, never as an un-disprovable "loading".
const EMPTY_PENDING: ReadonlySet<string> = new Set();

const GenImagePendingContext = createContext<ReadonlySet<string> | null>(
  EMPTY_PENDING,
);

export const GenImagePendingProvider = GenImagePendingContext.Provider;

export function useGenImagePending(): ReadonlySet<string> | null {
  return useContext(GenImagePendingContext);
}
