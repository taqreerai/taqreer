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
