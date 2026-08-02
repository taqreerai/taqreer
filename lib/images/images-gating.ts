// Generated-images (imagesMode) tier gating — client-safe, shared by:
//   • AIImagesPanel (the toggle's lock + UpgradeModal trigger, all 3 flows)
//   • the create page's design-style auto-enable back door
//   • preflightGenerate (the server 402 `images_locked` gate)
// Same shape as lib/export/export-gating.ts, and the same tier: generated
// images are a paid feature (imageCredits is priced below cost — free decks
// generating images lost money on every image, 2026-08 decision).

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
  if (user.isAdmin) return false;
  return !isPaidPlan(user.plan);
}
