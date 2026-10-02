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
import type { KnownPlan } from "@/lib/plan";
import { MAX_GENERATED_IMAGES } from "@/lib/images/slide-images";

export type Flow = "create" | "enhance" | "mimic" | "datasheet" | "social";

export const ALL_FLOWS: readonly Flow[] = [
  "create",
  "enhance",
  "mimic",
  "datasheet",
  "social",
];

export const CREDIT_COST: Record<Quality, { base: number; perSlide: number }> =
  {
    // Re-priced 2026-07-10 for the VISION LAYER (owner-approved +60 base
    // +12/slide on every preset): every generation now runs a second Opus
    // call - the freeze bake's vision review (screenshots + code in,
    // verdicts + revised sections out, thinking at effort medium).
    // Measured off the 2026-07-10 console day: review input ~2.2k
    // tokens/slide + ~2k fixed, output ~2.5-4k per REVISED slide -
    // ~$0.10 flat + $0.02/slide per bake at steady state. Numbers are
    // launch-provisional like opus-medium's (heavy-revision test day,
    // 5-slide decks); retune on 100+ persisted vision-usage rows.
    // History: 2026-07-07 repricing set fast 100+15 / balanced 400+22 /
    // medium 600+30 / fable-low 900+60 off prod Job averages (see
    // context/pricing-study-2026-07.md §3).
    // Sonnet restructure 2026-07-21: prices CASCADE up the ladder. Sonnet takes
    // the old opus-fast price; each Opus preset inherits the next-higher old
    // price (so the 3 price points are unchanged, just reassigned). opus-medium
    // kept for legacy decks (deactivated in the preset config).
    "sonnet-fast": { base: 160, perSlide: 27 },
    "opus-fast": { base: 460, perSlide: 34 },
    "opus-balanced": { base: 660, perSlide: 42 },
    "opus-medium": { base: 660, perSlide: 42 },
    "fable-low": { base: 960, perSlide: 72 },
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

// Credits per GENERATED IMAGE on images-mode decks. 2026-07-14 repricing:
// bumped 5 -> 10. Measured prod COGS is ~$0.053/image (gpt-image-2) at
// ~3.36 images/deck, so 5 credits (~$0.011 revenue) sold images ~5x below
// cost; 10 halves the subsidy while keeping images cheap. Still below the
// ~24-credit full break-even (deliberate, growth-first).
// This is the CLIENT-SAFE fallback; the server reads the DB-backed
// admin knob via getImageCredits() (lib/config/runtime-config).
export const IMAGE_CREDITS_PER_IMAGE = 10;

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

// Social carousels are short by nature (Instagram allows up to 20 cards), so the
// social flow caps the slide count HERE - below the deck tier cap (30/60/75).
// Without it, AUTO would hold the tier cap and price a single "post" at
// thousands of credits. Applied on BOTH the client estimate (social page) and
// the server hold (preflight) so shown == charged.
export const SOCIAL_SLIDE_CAP = 20;

/** The effective slide cap for a flow: social carousels cap low; every other
 *  flow uses the tier cap unchanged. */
export function slideCapForFlow(flow: Flow, tierCap: number): number {
  return flow === "social" ? Math.min(tierCap, SOCIAL_SLIDE_CAP) : tierCap;
}

// Teaser paywall (free-tier conversion). A free `create` deck is authored
// as a longer deck of which only the visible (tier-cap) slides render; the
// remaining TEASER_LOCKED_COUNT slides show blurred/locked in the viewer
// and are generated (on Opus, comped) only when the user subscribes. Kept
// here so the generation route, the viewer, and the unlock endpoint share
// one number. The visible count is the free tier's own slideCap, so the
// hold/charge is identical to today; only the locked count is added on top.
export const TEASER_LOCKED_COUNT = 5;

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

// The tier ladder. 2026-07-28 reprice: Plus $9 and Max $79, Pro held at $25
// (owner call on the 2026-07-28 margin re-eval; measured full-burn margins
// Plus 72%->62%, Max 70%->62% with fable-low on claude-opus-5, Pro stays 52%
// - a Pro cut to $19 would breach the >=50% floor). Supersedes the
// 2026-07-14 Gamma-parity $12/$25/$100 (see context/pricing-study-2026-07.md).
// Credits unchanged: Max 35,000 (2026-07-14), Plus/Pro held generous as
// acquisition tiers. free = 400 / 5-cap (admin-set 2026-07-14; ~1 deck,
// ~$0.36 measured COGS/user).
// Names Free/Plus/Pro/Max per user direction 2026-06-11. Keys match
// lib/plan.ts KNOWN_PLANS. NOTE: live charges come from Stripe (priceUsd is
// display-only) and live allotments from the DB Tier rows; these constants
// are the seed + client-safe fallback (parity asserted vs SEED_TIERS).
export const TIERS: Record<KnownPlan, TierConfig> = {
  // Preset ladder 2026-07-21 (Sonnet restructure): free = Sonnet entry model
  // only; Plus adds opus-fast; Pro/Max add opus-balanced. Must mirror
  // SEED_TIERS.unlockedPresetKeys (parity asserted).
  free: {
    priceUsd: 0,
    monthlyAllotment: 0,
    signupGrant: 400,
    slideCap: 8,
    presets: ["sonnet-fast"],
    flows: ["create"],
  },
  plus: {
    priceUsd: 9,
    monthlyAllotment: 4000,
    signupGrant: 0,
    slideCap: 30,
    presets: ["sonnet-fast", "opus-fast"],
    flows: ALL_FLOWS,
  },
  pro: {
    priceUsd: 25,
    monthlyAllotment: 10000,
    signupGrant: 0,
    slideCap: 60,
    presets: ["sonnet-fast", "opus-fast", "opus-balanced"],
    flows: ALL_FLOWS,
  },
  max: {
    priceUsd: 79,
    monthlyAllotment: 35000,
    signupGrant: 0,
    slideCap: 75,
    presets: ["sonnet-fast", "opus-fast", "opus-balanced", "fable-low"],
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

// Top-up packs (§1; 4 packs per user direction 2026-06-11 to match the 4
// tier cards). 2026-09-30 re-size (owner call): prices HELD, credits scaled
// to the current tiers (were 500/1,000/3,000/8,000, sized for the old
// 2,000/5,000/12,000 allotments). Per-credit prices sit ABOVE every tier's
// subscription rate (Pro is the priciest at $0.0025/credit; the cheapest
// pack here is Large at ~$0.00268) and fall with pack size, so topping up
// can never undercut upgrading - the "can't cheat the top-up system" rule.
// Keep credits in whole thousands. sourceKey idempotency lives in the
// ledger; this table is the catalog the pricing UI + Stripe Prices map
// onto, and checkout grants these credits (session metadata), so a credit
// change ships with the deploy even while the Stripe amount is unchanged.
export const TOPUP_PACKS = [
  { key: "mini", credits: 2_000, priceUsd: 7 },
  { key: "small", credits: 4_000, priceUsd: 12 },
  { key: "medium", credits: 11_000, priceUsd: 32 },
  { key: "large", credits: 28_000, priceUsd: 75 },
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

// Flat base charged ONCE per partial/slide regen run (2026-07-10 vision
// layer): every regen runs its own render + vision review + freeze bake,
// a per-run cost independent of how many slides it touches (~$0.15
// measured). CLIENT-SAFE fallback; the server passes the DB-backed admin
// knob (PlatformSettings.regenBaseCredits via getRegenBaseCredits).
export const REGEN_BASE_CREDITS = 70;

/** Partial/slide regen: one review-bake base per RUN + per regenerated
 *  slide. (A FULL deck regen re-dispatches deck.generate and bills through
 *  the generation formula instead.) */
export function regenCost(
  preset: Quality,
  slides: number,
  costOf: CostLookup = defaultCostLookup,
  regenBase: number = REGEN_BASE_CREDITS,
): number {
  if (slides <= 0) return 0;
  return regenBase + slides * costOf(preset).perSlide;
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
    case "text":
      // AUTO is the MODEL's decision (owner ruling 2026-07-18): no our-side
      // word-count heuristic - it lowballed a structured 8-slide carousel to
      // 5. Unknown → the quote holds the hard ceiling (tier cap ∧ credits)
      // and the model authors what the content calls for, up to it.
      return { slides: null, exact: false, basis: "unknown" };
    case "enhance":
      // 1:1 rebuild of the source - the page count IS the slide count.
      return { slides: Math.max(1, Math.floor(input.pageCount)), exact: true, basis: "pages" };
    case "mimic": {
      if (input.requested && input.requested > 0) {
        return { slides: Math.floor(input.requested), exact: true, basis: "user" };
      }
      // Typed-brief mimic without an explicit pick: same auto law as text.
      return { slides: null, exact: false, basis: "unknown" };
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
 * it). An UNKNOWN estimate (auto text/mimic-brief, create-from-file - the
 * model decides the count) displays the CEILING the server will hold - the
 * tier cap - flagged `upTo: true` so the button renders "up to" pricing
 * instead of a committed number. Pure + client-safe (same as estimateSlides),
 * so create/datasheet/mimic can call it directly.
 */
export function displaySlideEstimate(
  input: SlideEstimateInput,
  slideCap: number,
): { slides: number; upTo: boolean } {
  const est = estimateSlides(input);
  return est.slides == null
    ? { slides: slideCap, upTo: true }
    : // ANY non-exact estimate is a maximum, not a commitment (the settle
      // charges the actual authored count) - datasheet's structural estimate
      // included (CR #154).
      { slides: Math.min(est.slides, slideCap), upTo: !est.exact };
}

// The smallest deck the reduced-slides offer (and the display's affordability
// clamp) will go down to. Lives here (client-safe) because the split button
// mirrors the server's probe-down for the "up to" ceiling display; preflight
// re-exports it for its server-side uses.
export const MIN_REDUCED_SLIDES = 3;

/**
 * What one generation request will hold and (at most) charge.
 *
 * Exact counts: hold == charge == the quoted number.
 * Unknown (auto/model-decided) + non-exact estimates: hold the CEILING -
 *               the tier slide cap (owner ruling 2026-07-18: auto is only
 *               hard-capped by tier + credits; preflight lowers the
 *               ceiling to what the balance affords) - and settle on the
 *               actual manifest count, clamped to the hold, so the user
 *               is NEVER charged more than the number they were shown.
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
    // Unknown = the model decides; the hold IS the ceiling (tier cap;
    // admin tiers carry SYSTEM_SLIDE_CAP; preflight lowers by balance).
    args.estimate.slides ?? args.slideCap,
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
