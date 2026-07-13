// Export tier-gating - the ONE table of which export formats each plan
// may use (user direction 2026-07-13):
//
//   free  → PNG only on standard (16:9 / 9:16) decks. On 3:4 social decks
//           (whose menu offers PDF + PNG only) even PNG is gated, so free
//           has no social export at all.
//   plus+ → everything.
//   admin → everything (superuser bypass, mirrors preflightGenerate).
//
// The pure predicate below is shared by BOTH surfaces that render export
// affordances (ExportMenu dropdown + ShareDialog Export tab) and mirrors
// the server-side checks in /api/projects/[id]/export/{pdf,png}. Client
// gating is the UX (gold crown → UpgradeModal); the server 402 is the
// enforcement for the routes that exist. PPTX/Google Slides run fully
// client-side (no route), so for them the UI gate is the only stop -
// acceptable, the bypass audience is devtools users.

import { normalizePlan } from "@/lib/plan";
import type { KnownPlan } from "@/lib/plan";

export type GateableExportKind = "pptx" | "pdf" | "png" | "gslides";

/** The tier that unlocks paid exports - drives UpgradeModal's minTier. */
export const EXPORT_GATE_TIER: KnownPlan = "plus";

/**
 * Whether an export format is tier-gated for this user on this deck.
 *
 * `plan: null` means "unknown" (signed-out public-link viewer, or
 * /api/credits not resolved yet) and gates like free - anonymous
 * viewers must never get paid formats, and a paid user's pre-hydration
 * crown flash is behind a menu click anyway.
 */
export function isExportGated(
  kind: GateableExportKind,
  format: string | undefined,
  user: { plan: string | null; isAdmin: boolean },
): boolean {
  if (user.isAdmin) return false;
  if (user.plan !== null && normalizePlan(user.plan) !== "free") return false;
  return kind !== "png" || (format ?? "16:9") === "3:4";
}
