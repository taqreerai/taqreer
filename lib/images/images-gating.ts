// Generated-images (imagesMode) tier gating — client-safe, shared by:
//   • AIImagesPanel (the toggle's lock + UpgradeModal trigger, all 3 flows)
//   • the create page's design-style auto-enable back door
//   • preflightGenerate (the server 402 `images_locked` gate)
// Same shape as lib/export/export-gating.ts.
//
// 2026-10-04 (owner decision): generated images are UNLOCKED for every plan.
// Free accounts get them at 0 credits per image (imageCreditsForPlan), so a
// free 8-slide deck still fits the 400 signup grant. That is self-limiting:
// free accounts can't buy top-ups, so the free images end with the grant.
// Paid plans pay the DB per-image rate as before. The lock + UpgradeModal
// plumbing stays so the gate can be restored by editing isImagesLocked.

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
}): boolean {
  void user;
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
