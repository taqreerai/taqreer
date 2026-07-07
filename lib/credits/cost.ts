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
import { MAX_GENERATED_IMAGES } from "@/lib/images/slide-images";

export type Flow = "create" | "enhance" | "mimic" | "datasheet";

export const ALL_FLOWS: readonly Flow[] = [
  "create",
  "enhance",
  "mimic",
  "datasheet",
];

export const CREDIT_COST: Record<Quality, { base: number; perSlide: number }> =
  {
    // Re-priced 2026-07-07 off PRODUCTION Job-table averages (see
    // context/pricing-study-2026-07.md §3): opus-fast really costs
    // ~$0.62/deck (not the $0.10 sample the 06-12 pricing used), so
    // its perSlide moved 10 -> 15 to stay above cost at the cheaper
    // per-credit revenue of the 2026-07 ladder. opus-balanced measured
    // ~$0.89/deck - its old price already clears cost, unchanged.
    // fable-low measured ~$3.22/deck (n=1): repriced 500+28 -> 900+60
    // so it can NEVER be reactivated below cost; stays inactive until
    // demand + a bigger sample justify it.
    "opus-fast": { base: 100, perSlide: 15 },
    "opus-balanced": { base: 400, perSlide: 22 },
    "fable-low": { base: 900, perSlide: 60 },
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

// Credits per GENERATED IMAGE on images-mode decks (2026-07 repricing:
// gpt-image-2 costs ~$0.05-0.08/image and was previously uncharged -
// the biggest unpriced COGS, see context/pricing-study-2026-07.md).
// This is the CLIENT-SAFE fallback; the server reads the DB-backed
// admin knob via getImageCredits() (lib/config/runtime-config).
export const IMAGE_CREDITS_PER_IMAGE = 5;

/**
 * The image surcharge a generation HOLDS for: one image per slide, capped
 * at the per-deck image ceiling (MAX_GENERATED_IMAGES). Claude reserves
 * boxes freely, so the settle charges the ACTUAL box count - clamped to
 * the hold like everything else, so overflow boxes are free rather than
 * ever exceeding the shown estimate. 0 when images mode is off.
 */
export function imagesSurcharge(
  slides: number,
  imagesMode: boolean,
  perImage: number = IMAGE_CREDITS_PER_IMAGE,
): number {
  if (!imagesMode) return 0;
  return Math.min(Math.max(0, slides), MAX_GENERATED_IMAGES) * perImage;
}

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

// The tier ladder - growth-first repricing 2026-07-07 (see
// context/pricing-study-2026-07.md §1): undercuts Gamma on every tier
// with ~2x its credits; free = 1,000 one-time (~4 decks incl. images).
// Names Free/Plus/Pro/Max per user direction 2026-06-11. Keys match
// lib/plan.ts KNOWN_PLANS.
export const TIERS: Record<KnownPlan, TierConfig> = {
  free: {
    priceUsd: 0,
    monthlyAllotment: 0,
    signupGrant: 1000,
    slideCap: 10,
    presets: ["opus-fast"],
    flows: ["create"],
  },
  plus: {
    priceUsd: 9,
    monthlyAllotment: 4000,
    signupGrant: 0,
    slideCap: 30,
    presets: ["opus-fast", "opus-balanced"],
    flows: ALL_FLOWS,
  },
  pro: {
    priceUsd: 19,
    monthlyAllotment: 10000,
    signupGrant: 0,
    slideCap: 60,
    presets: ["opus-fast", "opus-balanced", "fable-low"],
    flows: ALL_FLOWS,
  },
  max: {
    priceUsd: 49,
    monthlyAllotment: 28000,
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
// tier's subscription rate (after the 2026-07 repricing Plus is the
// priciest at $0.00225/credit; the cheapest pack here is $0.0094) so
// topping up can never undercut upgrading - the "can't cheat the
// top-up system" rule. sourceKey
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
  // Images-mode surcharge (imagesSurcharge): the hold covers one image
  // per slide up to the deck ceiling; the settle charges actual boxes.
  imagesMode?: boolean;
  // Server passes getImageCredits() (DB-backed); omit for the constant.
  imageCredits?: number;
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
    holdCredits:
      generationCost(effective, holdSlides, args.costOf) +
      imagesSurcharge(holdSlides, args.imagesMode === true, args.imageCredits),
    exact: args.estimate.exact,
  };
}
