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
    "sonnet-fast": { base: 100, perSlide: 10 },
    "opus-fast": { base: 350, perSlide: 16 },
    "opus-balanced": { base: 400, perSlide: 22 },
  };

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

// The LOCKED tier ladder (§1). Keys match lib/plan.ts KNOWN_PLANS.
export const TIERS: Record<KnownPlan, TierConfig> = {
  free: {
    priceUsd: 0,
    monthlyAllotment: 0,
    signupGrant: 400,
    slideCap: 10,
    presets: ["sonnet-fast"],
    flows: ["create"],
  },
  starter: {
    priceUsd: 15,
    monthlyAllotment: 2000,
    signupGrant: 0,
    slideCap: 30,
    presets: ["sonnet-fast", "opus-fast"],
    flows: ALL_FLOWS,
  },
  plus: {
    priceUsd: 30,
    monthlyAllotment: 5000,
    signupGrant: 0,
    slideCap: 60,
    presets: ["sonnet-fast", "opus-fast", "opus-balanced"],
    flows: ALL_FLOWS,
  },
  pro: {
    priceUsd: 70,
    monthlyAllotment: 12000,
    signupGrant: 0,
    slideCap: 75,
    presets: ["sonnet-fast", "opus-fast", "opus-balanced"],
    flows: ALL_FLOWS,
  },
};

// Top-up packs (§1, PROPOSED). sourceKey idempotency lives in the
// ledger; this table is the catalog the pricing UI + Stripe Prices
// will map onto.
export const TOPUP_PACKS = [
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
export function generationCost(preset: Quality, slides: number): number {
  const { base, perSlide } = CREDIT_COST[preset];
  return base + Math.max(0, slides) * perSlide;
}

/** Regen (partial or full): no base, per regenerated slide only (§3). */
export function regenCost(preset: Quality, slides: number): number {
  return Math.max(0, slides) * CREDIT_COST[preset].perSlide;
}

/**
 * The largest deck a balance can afford on a preset. 0 when even the
 * base doesn't fit. Used for the "condensed version" offer when the
 * input is worth more slides than the balance covers.
 */
export function maxAffordableSlides(preset: Quality, balance: number): number {
  const { base, perSlide } = CREDIT_COST[preset];
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
 * What one generation request will hold and (at most) charge.
 *
 * Exact counts: hold == charge == the quoted number.
 * Estimates:    hold the estimated count (or the tier cap when the
 *               input is unknowable), settle on the actual manifest
 *               count - clamped to the hold, so the user is NEVER
 *               charged more than the number they were shown.
 */
export function quoteGeneration(args: {
  preset: Quality;
  flow: Flow;
  estimate: SlideEstimate;
  slideCap: number;
}): {
  effective: Quality;
  holdSlides: number;
  holdCredits: number;
  exact: boolean;
} {
  const effective = effectivePreset(args.preset, args.flow);
  const holdSlides = Math.min(
    args.estimate.slides ?? args.slideCap,
    args.slideCap,
  );
  return {
    effective,
    holdSlides,
    holdCredits: generationCost(effective, holdSlides),
    exact: args.estimate.exact,
  };
}
