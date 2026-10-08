"use client";

// Whether the deck open in the studio was bought outright (one-time unlock,
// 2026-10-08). DeckView provides it; client-side exports (PPTX / Google
// Slides) read it so a bought deck exports without the free watermark even
// though its owner is on the free plan. Default false (no provider = the
// plan-based rule applies unchanged).

import { createContext, useContext } from "react";

export const DeckPurchaseContext = createContext(false);

export function useDeckPurchased(): boolean {
  return useContext(DeckPurchaseContext);
}
