// Generated-images (imagesMode) tier gating — client-safe, shared by:
//   • AIImagesPanel (the toggle's lock + UpgradeModal trigger, all 3 flows)
//   • the create page's design-style auto-enable back door
//   • preflightGenerate (the server 402 `images_locked` gate)
// Same shape as lib/export/export-gating.ts.
//
// 2026-10-04 (owner decision): generated images unlocked for every plan, free
// accounts at 0 credits per image (imageCreditsForPlan).
// 2026-10-14 (owner decision, final): images are locked ONLY for the
// region-limited free accounts (lib/credits/region-model, the Haiku-only
// countries, to cap spend there); everyone else has them, free accounts included.
// Admins are always exempt. Existing decks keep the images they already have.
// 2026-10-29 (owner decision): unlocked for the region-limited free accounts
// too. Their images come from Pexels only (no library, no AI), so they cost
// nothing (lib/images/image-source.ts fillImage, tier "region").

import { type KnownPlan, isPaidPlan } from "@/lib/plan";

/** The tier that unlocks generated images - drives UpgradeModal's minTier. */
export const IMAGES_GATE_TIER: KnownPlan = "plus";

/**
 * Whether generated images are locked for this user. Nobody is locked since
 * 2026-10-29; the gate stays wired (toggle, create back door, server
 * preflight) so a future limit is a one-line change here.
 */
export function isImagesLocked(_user: {
  regionLimited: boolean;
  isAdmin: boolean;
}): boolean {
  return false;
}

/**
 * Credits charged per generated image for a plan: 0 on free (the trial perk
 * above), the given rate on paid plans. Used by the client estimate, the
 * preflight hold and the deck-generate settle so shown == held == charged.
 * `perImage` undefined (client before /api/credits resolves) passes through
 * so imagesSurcharge falls back to its bundled constant.
 */
export function imageCreditsForPlan<T extends number | undefined>(
  plan: string | null | undefined,
  perImage: T,
): T | 0 {
  return isPaidPlan(plan) ? perImage : 0;
}
