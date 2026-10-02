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

// Full deck export set, in menu order.
const ALL_EXPORT_KINDS: readonly GateableExportKind[] = [
  "pptx",
  "pdf",
  "gslides",
  "png",
];

// Ratios that are PDF/PNG-only regardless of flow: the social-only ratios
// (never reachable outside the social flow) + the legacy 3:4 "Post". 9:16 and
// 16:9 are deliberately NOT here, so create/mimic decks at those ratios KEEP
// full PPTX/Google Slides export.
const PDF_PNG_ONLY_FORMATS: ReadonlySet<string> = new Set([
  "1:1",
  "4:5",
  "3:4",
]);

/** True when a deck's format alone forces PDF/PNG-only export (independent of
 *  flow). Used by the export runner guards for pptx/gslides. */
export function isPdfPngOnlyFormat(format: string | undefined): boolean {
  return PDF_PNG_ONLY_FORMATS.has(format ?? "16:9");
}

/**
 * Which export formats to OFFER, given the flow + format. SOCIAL projects (any
 * ratio, incl 9:16/16:9) and any PDF/PNG-only format are PDF + PNG only (no
 * PPTX/Google Slides); everything else offers all four. Single source replacing
 * the duplicated inline `=== "3:4"` filters in ExportMenu + ShareDialog.
 */
export function visibleExportKinds(
  isSocial: boolean,
  format: string | undefined,
): GateableExportKind[] {
  if (isSocial || isPdfPngOnlyFormat(format)) return ["pdf", "png"];
  return [...ALL_EXPORT_KINDS];
}

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
  if ((format ?? "16:9") === "3:4") return true;
  if (kind === "png") return false;
  // Free plan (2026-10-02): PPTX is open to signed-in free users; the deck
  // carries the "Made with taqreer.ai" watermark + branded closing slide
  // (lib/export/free-branding). An unknown plan (signed-out public-link
  // viewer) stays PNG-only, so nobody can pull an unbranded PPTX of a
  // shared deck. PDF and Google Slides stay paid.
  return !(kind === "pptx" && user.plan !== null);
}
