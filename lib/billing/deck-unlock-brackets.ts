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

// Regional one-time unlock prices (owner decision 2026-10-12) for free accounts
// from the region-limited countries (lib/credits/region-model). Separate Stripe
// prices (lookup key suffix "_regional"); the bracket sizes match the table above.
// PROPOSED amounts: confirm before the Stripe prices are created.
export const REGIONAL_DECK_UNLOCK_CENTS: Record<DeckUnlockBracket, number> = {
  s: 199,
  m: 249,
  l: 299,
};

export function deckUnlockLookupKey(bracket: DeckUnlockBracket, regional = false): string {
  return regional ? `deck_unlock_${bracket}_regional` : `deck_unlock_${bracket}`;
}

/** The price a buyer pays for a bracket, regional or standard. */
export function deckUnlockPriceCents(bracket: DeckUnlockBracket, regional: boolean): number {
  if (regional) return REGIONAL_DECK_UNLOCK_CENTS[bracket];
  return DECK_UNLOCK_BRACKETS.find((b) => b.key === bracket)!.priceCents;
}

/** The bracket for a deck of `slides` slides, or null above the last one. */
export function bracketForSlides(slides: number): DeckUnlockBracket | null {
  return DECK_UNLOCK_BRACKETS.find((b) => slides <= b.maxSlides)?.key ?? null;
}

/** Planned size of a teaser deck: the built (visible) part plus the tail.
 *  `builtCount` is the deck's own built count (aiPrompt.slideCount); since the
 *  built part varies per deck (2026-11-07: up to 10, at least 3 locked), it
 *  wins over the flow default, which only covers decks that lack it. */
export function teaserTotalSlides(
  projectType: string,
  lockedCount: number,
  builtCount?: number | null,
): number {
  const flow = projectType === "social" ? "social" : "create";
  const built = builtCount && builtCount > 0 ? builtCount : teaserVisibleForFlow(flow);
  return built + Math.max(0, lockedCount);
}

/** The built count a teaser deck stored at creation (aiPrompt.slideCount). */
export function teaserBuiltFromPrompt(aiPrompt: string | null | undefined): number | null {
  if (!aiPrompt) return null;
  try {
    const n = (JSON.parse(aiPrompt) as { slideCount?: unknown }).slideCount;
    return typeof n === "number" && n > 0 ? n : null;
  } catch {
    return null;
  }
}
