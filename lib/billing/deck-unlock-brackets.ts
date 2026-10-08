// One-time deck unlock brackets (2026-10-08). Pure data + helpers, safe for
// client bundles (the billing catalog in lib/billing/prices.ts imports it);
// the server-side purchase / dispatch logic lives in lib/billing/deck-unlock.

import { teaserVisibleForFlow } from "@/lib/credits/cost";

export type DeckUnlockBracket = "s" | "m" | "l";

export const DECK_UNLOCK_BRACKETS: ReadonlyArray<{
  key: DeckUnlockBracket;
  maxSlides: number;
  priceCents: number;
}> = [
  { key: "s", maxSlides: 15, priceCents: 499 },
  { key: "m", maxSlides: 30, priceCents: 599 },
  { key: "l", maxSlides: 50, priceCents: 699 },
];

export function deckUnlockLookupKey(bracket: DeckUnlockBracket): string {
  return `deck_unlock_${bracket}`;
}

/** The bracket for a deck of `slides` slides, or null above the last one. */
export function bracketForSlides(slides: number): DeckUnlockBracket | null {
  return DECK_UNLOCK_BRACKETS.find((b) => slides <= b.maxSlides)?.key ?? null;
}

/** Planned size of a teaser deck: the built (visible) part plus the tail. */
export function teaserTotalSlides(projectType: string, lockedCount: number): number {
  const flow = projectType === "social" ? "social" : "create";
  return teaserVisibleForFlow(flow) + Math.max(0, lockedCount);
}
