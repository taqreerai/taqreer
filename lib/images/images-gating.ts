// Generated-images (imagesMode) tier gating — client-safe, shared by:
//   • AIImagesPanel (the toggle's lock + UpgradeModal trigger, all 3 flows)
//   • the create page's design-style auto-enable back door
//   • preflightGenerate (the server 402 `images_locked` gate)
// Same shape as lib/export/export-gating.ts.
//
// 2026-10-04 (owner decision): generated images were unlocked for every plan,
// free accounts at 0 credits per image (imageCreditsForPlan).
// 2026-10-14 (owner decision): locked for free accounts again, a paid-plan
// feature for now. Paid plans pay the DB per-image rate. Admins are exempt.
// The lock + UpgradeModal plumbing is the original one; only isImagesLocked
// changed. Existing decks keep the images they already have.
// 2026-10-14 (owner decision): the ENHANCE flow is open to free accounts with
// images locked ON (a 1:1 rebuild without them left every source photo as an
// "Upload your picture" placeholder). Free images cost 0 credits and the free
// deck is a 5-slide teaser, so the spend is bounded. The Enhance page shows the
// toggle locked on for free accounts.

import { type KnownPlan, isPaidPlan } from "@/lib/plan";

/** The tier that unlocks generated images - drives UpgradeModal's minTier. */
export const IMAGES_GATE_TIER: KnownPlan = "plus";

/**
 * Whether generated images are tier-locked for this user.
 *
 * `plan: null` means "unknown" (the /api/credits fetch hasn't resolved yet)
 * and gates like free — the ExportMenu stance. The toggle defaults OFF, so a
 * paying user's pre-hydration state is simply "off + crown for a beat", never
 * a wrongly-blocked enabled state.
 */
export function isImagesLocked(user: {
  plan: string | null;
  isAdmin: boolean;
  /** Credit flow of the run; Enhance is open to every plan. */
  flow?: string;
}): boolean {
  if (user.isAdmin) return false;
  if (user.flow === "enhance") return false;
  return !isPaidPlan(user.plan);
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
