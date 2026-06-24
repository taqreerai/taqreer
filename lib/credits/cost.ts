// Credit cost mirror - the runtime twin of context/subscriptionmodel.md
// §1-§3a. CLIENT-SAFE: pure data + math, no Prisma, no env. Imported by
// both the server ledger (lib/credits/server.ts, preflight.ts) and the
// client estimate UI (GenerateSplitButton), so the number the user sees
// and the number the ledger charges come from the SAME table.
//
// Formula (§3):  credits = base[preset] + slides × perSlide[preset]
// Values are PROPOSED - re-tune with 100+ measured runs per preset, but
// keep the flat ≈$0.0022/credit COGS property (§4) when re-tuning.

import type { Quality } from "@/lib/types/quality";
import { estimateSlideCountFromText } from "@/lib/types/quality";
import type { KnownPlan } from "@/lib/plan";

export type Flow = "create" | "enhance" | "mimic" | "datasheet";

export const ALL_FLOWS: readonly Flow[] = [
  "create",
  "enhance",
  "mimic",
  "datasheet",
];

export const CREDIT_COST: Record<Quality, { base: number; perSlide: number }> =
  {
    // Re-priced 2026-06-12 off MEASURED COGS (thinking-off Opus 4.8
    // produced a 5-slide deck for ~$0.10): 100+10 keeps >90% margin
    // while making the default preset feel cheap. opus-balanced holds
    // its old price until its 4.8 thinking baseline is measured.
    // fable-low is PROVISIONAL (Fable 5 is $10/$50 per MTok - 2x
    // Opus) pending the same baseline.
    "opus-fast": { base: 100, perSlide: 10 },
    "opus-balanced": { base: 400, perSlide: 22 },
    "fable-low": { base: 500, perSlide: 28 },
  };

// A preset → cost lookup. Defaults to the CREDIT_COST constant (the client
// snapshot). The server passes `creditCostFor` (DB-backed, lib/config/
// runtime-config) so an admin cost edit takes effect on the charge, while the
// client estimate stays on the bundled constant until it receives props.
export type CostLookup = (preset: string) => { base: number; perSlide: number };
const defaultCostLookup: CostLookup = (preset) =>
  CREDIT_COST[preset] ?? CREDIT_COST["opus-fast"];

// Haiku title/name generation - flat (§3).
export const NAME_GEN_COST = 5;

// Nothing above 75 slides is ever exposed (≈128k output-token ceiling).
export const SYSTEM_SLIDE_CAP = 75;

// Top-up packs expire 12 months after purchase (§1).
export const TOPUP_EXPIRY_MONTHS = 12;

export type TierConfig = {
  priceUsd: number;
  // Per-cycle grant; 0 for Free (signup grant is one-time).
  monthlyAllotment: number;
  // One-time grant on account creation (Free trial budget).
  signupGrant: number;
  slideCap: number;
  presets: readonly Quality[];
  flows: readonly Flow[];
};

// The tier ladder (§1; names Free/Plus/Pro/Max per user direction
// 2026-06-11 - the grants/caps/gates are the original LOCKED values,
// only the labels moved: starter->plus, plus->pro, pro->max). Keys
// match lib/plan.ts KNOWN_PLANS.
export const TIERS: Record<KnownPlan, TierConfig> = {
  free: {
    priceUsd: 0,
    monthlyAllotment: 0,
    signupGrant: 400,
    slideCap: 10,
    presets: ["opus-fast"],
    flows: ["create"],
  },
  plus: {
    priceUsd: 15,
    monthlyAllotment: 2000,
    signupGrant: 0,
    slideCap: 30,
    presets: ["opus-fast", "opus-balanced"],
    flows: ALL_FLOWS,
  },
  pro: {
    priceUsd: 30,
    monthlyAllotment: 5000,
    signupGrant: 0,
    slideCap: 60,
    presets: ["opus-fast", "opus-balanced", "fable-low"],
    flows: ALL_FLOWS,
  },
  max: {
    priceUsd: 70,
    monthlyAllotment: 12000,
    signupGrant: 0,
    slideCap: 75,
    presets: ["opus-fast", "opus-balanced", "fable-low"],
    flows: ALL_FLOWS,
  },
};

// Upgrade ladder, cheapest first - drives "Turn {nextTier}" CTAs.
export const TIER_ORDER: readonly KnownPlan[] = ["free", "plus", "pro", "max"];

/** The next tier up, or null when already on the top tier. */
export function nextTier(plan: KnownPlan): KnownPlan | null {
  const idx = TIER_ORDER.indexOf(plan);
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

// Top-up packs (§1, PROPOSED; 4 packs per user direction 2026-06-11 to
// match the 4 tier cards). Per-credit prices sit WELL ABOVE every
// tier's subscription rate (Plus is the priciest at $0.0075/credit;
// the cheapest pack here is $0.0094) so topping up can never undercut
// upgrading - the "can't cheat the top-up system" rule. sourceKey
// idempotency lives in the ledger; this table is the catalog the
// pricing UI + Stripe Prices map onto.
export const TOPUP_PACKS = [
  { key: "mini", credits: 500, priceUsd: 7 },
  { key: "small", credits: 1_000, priceUsd: 12 },
  { key: "medium", credits: 3_000, priceUsd: 32 },
  { key: "large", credits: 8_000, priceUsd: 75 },
] as const;

/**
 * The preset a request ACTUALLY runs on (and must be priced on).
 *
 * The source-flow auto-upgrade (§6) is currently DISABLED in
 * `deck-generate.ts` (`resolveEffectiveQuality` returns the user's pick
 * verbatim - 2026-05-30 decision: the streaming parser salvages partial
 * responses instead of force-upgrading Sonnet). This identity function
 * is the single seam every estimate AND every charge routes through, so
 * re-enabling the upgrade later is a one-line change here + in
 * deck-generate, and the shown price stays the charged price.
 */
export function effectivePreset(preset: Quality, _flow: Flow): Quality {
  return preset;
}

/** §3 formula: full-deck generation cost. */
export function generationCost(
  preset: Quality,
  slides: number,
  costOf: CostLookup = defaultCostLookup,
): number {
  const { base, perSlide } = costOf(preset);
  return base + Math.max(0, slides) * perSlide;
}

/** Regen (partial or full): no base, per regenerated slide only (§3). */
export function regenCost(
  preset: Quality,
  slides: number,
  costOf: CostLookup = defaultCostLookup,
): number {
  return Math.max(0, slides) * costOf(preset).perSlide;
}

/**
 * The largest deck a balance can afford on a preset. 0 when even the
 * base doesn't fit. Used for the "condensed version" offer when the
 * input is worth more slides than the balance covers.
 */
export function maxAffordableSlides(
  preset: Quality,
  balance: number,
  costOf: CostLookup = defaultCostLookup,
): number {
  const { base, perSlide } = costOf(preset);
  if (balance < base + perSlide) return 0;
  return Math.floor((balance - base) / perSlide);
}

// ─── Per-flow slide estimation (§2 of the test spec) ────────────────
//
// Each flow estimates differently because each flow KNOWS differently:
//   create/text  → input length (~1 slide / 100 words; reuses the same
//                  estimator the brief already ships to Claude)
//   enhance      → source page count, known exactly up front (1:1 rebuild)
//   mimic        → the reference sets the LOOK, not the length - count
//                  comes from the brief text or the user's explicit pick
//   datasheet    → data structure (sheets + row volume)
//   user-set     → exact, always wins
export type SlideEstimateInput =
  | { kind: "fixed"; count: number }
  | { kind: "text"; text: string }
  | { kind: "enhance"; pageCount: number }
  | { kind: "mimic"; briefText?: string | null; requested?: number | null }
  | { kind: "datasheet"; sheetCount: number; totalRows: number };

export type SlideEstimate = {
  // null = genuinely unknown (e.g. create-from-file before extraction):
  // the hold must assume the tier slide cap ("up to N").
  slides: number | null;
  // exact counts charge as-is; estimates pre-auth and settle on the
  // actual manifest count.
  exact: boolean;
  basis: "user" | "text" | "pages" | "data" | "unknown";
};

export function estimateSlides(input: SlideEstimateInput): SlideEstimate {
  switch (input.kind) {
    case "fixed":
      return { slides: Math.max(1, Math.floor(input.count)), exact: true, basis: "user" };
    case "text": {
      const slides = estimateSlideCountFromText(input.text);
      return slides === null
        ? { slides: null, exact: false, basis: "unknown" }
        : { slides, exact: false, basis: "text" };
    }
    case "enhance":
      // 1:1 rebuild of the source - the page count IS the slide count.
      return { slides: Math.max(1, Math.floor(input.pageCount)), exact: true, basis: "pages" };
    case "mimic": {
      if (input.requested && input.requested > 0) {
        return { slides: Math.floor(input.requested), exact: true, basis: "user" };
      }
      const fromBrief = estimateSlideCountFromText(input.briefText);
      return fromBrief === null
        ? { slides: null, exact: false, basis: "unknown" }
        : { slides: fromBrief, exact: false, basis: "text" };
    }
    case "datasheet": {
      // PROPOSED structural heuristic: cover + closing (2) + one
      // overview slide per sheet + ~1 insight slide per 20 data rows,
      // clamped to a sane deck. Tune against real datasheet runs.
      const sheets = Math.max(1, Math.floor(input.sheetCount));
      const rows = Math.max(0, Math.floor(input.totalRows));
      const raw = 2 + sheets + Math.ceil(rows / 20);
      return {
        slides: Math.max(4, Math.min(20, raw)),
        exact: false,
        basis: "data",
      };
    }
  }
}

/**
 * The slide count to DISPLAY on the split-button credit estimate. Reuses the
 * server's estimateSlides so the shown price tracks the run, then clamps to the
 * user's tier cap (the run is capped there too, so the estimate must not exceed
 * it). A null (unknown) estimate collapses to undefined, letting the button fall
 * back to its historical 8-slide default. Pure + client-safe (same as
 * estimateSlides), so create/datasheet/mimic can call it directly.
 */
export function displaySlideEstimate(
  input: SlideEstimateInput,
  slideCap: number,
): number | undefined {
  const est = estimateSlides(input).slides;
  return est == null ? undefined : Math.min(est, slideCap);
}

// When the input size is unknowable up front (create-from-file before
// extraction), the prompt's own default targets 8-12 slides - hold for
// that upper bound (capped by the tier), not the full tier cap, so a
// Max user isn't pre-authorized 1,700+ credits for a 10-slide deck.
export const UNKNOWN_INPUT_HOLD_SLIDES = 12;

/**
 * What one generation request will hold and (at most) charge.
 *
 * Exact counts: hold == charge == the quoted number.
 * Estimates:    hold the estimated count (or the unknown-input default
 *               when the input is unknowable), settle on the actual
 *               manifest count - clamped to the hold, so the user is
 *               NEVER charged more than the number they were shown.
 */
export function quoteGeneration(args: {
  preset: Quality;
  flow: Flow;
  estimate: SlideEstimate;
  slideCap: number;
  // Server passes creditCostFor (DB-backed); omit on the client for the constant.
  costOf?: CostLookup;
}): {
  effective: Quality;
  holdSlides: number;
  holdCredits: number;
  exact: boolean;
} {
  const effective = effectivePreset(args.preset, args.flow);
  const holdSlides = Math.min(
    args.estimate.slides ?? UNKNOWN_INPUT_HOLD_SLIDES,
    args.slideCap,
  );
  return {
    effective,
    holdSlides,
    holdCredits: generationCost(effective, holdSlides, args.costOf),
    exact: args.estimate.exact,
  };
}
