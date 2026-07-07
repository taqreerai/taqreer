// Generation preflight - the decision the product makes BEFORE any hold
// is placed (test spec §3: never quietly produce a chopped deck, never
// charge for a broken result, stop and offer real choices).
//
// Order of gates:
//   1. flow locked for the tier            → upgrade
//   2. preset locked for the tier          → upgrade
//   3. slide count above the tier cap      → block (never truncate; §5)
//   4. cost above the spendable balance    → block with TWO offers
//      (user direction 2026-06-11 - simplified from the earlier
//      condensed/cheaper/top-up triple):
//        a. reduce the slide count to what the balance affords (the
//           deck is simply AUTHORED at the smaller count - no special
//           summarize machinery; the brief's slide count already
//           drives how content is distributed)
//        b. top up the gap (needs N, you have M)
//      `cheaperPresets` stays in the payload as supporting info (the
//      preset menu shows per-preset prices anyway) but is not one of
//      the primary offers.
// Only after all four pass may the caller place the hold.

import type { Quality } from "@/lib/types/quality";
import { normalizePlan } from "@/lib/plan";
import {
  type Flow,
  type SlideEstimateInput,
  ALL_FLOWS,
  SYSTEM_SLIDE_CAP,
  estimateSlides,
  effectivePreset,
  generationCost,
  imagesSurcharge,
  maxAffordableSlides,
  quoteGeneration,
} from "@/lib/credits/cost";
import {
  type TierConfigRow,
  ensureFresh,
  getTier,
  getActivePresets,
  getActivePresetKeys,
  getImageCredits,
  creditCostFor,
} from "@/lib/config/runtime-config";
import { getBalance, type BalanceSnapshot } from "@/lib/credits/server";

// A deck below this is not a deck (cover + body + closing).
export const MIN_REDUCED_SLIDES = 3;

export type PresetQuote = {
  preset: Quality;
  // What it actually runs (and is priced) on - identity today.
  effective: Quality;
  unlocked: boolean;
  // Credits for the quoted slide count (the hold amount). Null when
  // the preset is locked for the tier.
  credits: number | null;
  affordable: boolean;
};

export type PreflightOk = {
  ok: true;
  plan: string;
  balance: BalanceSnapshot;
  holdSlides: number;
  holdCredits: number;
  // True when the count is user-set / source-derived (charge == quote);
  // false when estimated (hold the quote, settle on the actual count).
  exact: boolean;
  // True when the input estimated MORE slides than the tier cap and the
  // deck will be authored condensed at the cap. Surfaced so the UI says
  // so up front - the cap is never applied silently.
  cappedToTier: boolean;
  quotes: PresetQuote[];
};

export type PreflightBlocked = {
  ok: false;
  plan: string;
  balance: BalanceSnapshot;
  reason:
    | "flow_locked"
    | "preset_locked"
    | "slide_cap_exceeded"
    | "insufficient_credits";
  // For flow_locked: the cheapest tier whose flows include the requested
  // flow (from live config), so the gate copy names the right plan
  // instead of a hardcoded tier name. Null if NO tier unlocks the flow.
  minFlowTier?: string | null;
  // For slide_cap_exceeded: the cap that was exceeded.
  slideCap?: number;
  // For insufficient_credits - the two offers (+ supporting info).
  options?: {
    // Largest deck the balance affords on the chosen preset
    // (null when even MIN_REDUCED_SLIDES doesn't fit) - offer (a).
    reducedSlides: number | null;
    reducedCredits: number | null;
    // Unlocked presets whose FULL-size cost fits the balance.
    cheaperPresets: Quality[];
    // needs − have.
    topupGap: number;
  };
  quotes: PresetQuote[];
};

export type PreflightResult = PreflightOk | PreflightBlocked;

export async function preflightGenerate(args: {
  userId: string;
  plan: string;
  flow: Flow;
  preset: Quality;
  slideInput: SlideEstimateInput;
  // Images-mode deck: the quote (and hold) carries the per-image
  // surcharge (imagesSurcharge) on top of the slide cost.
  imagesMode?: boolean;
  // Admin/superuser: all flows + presets unlocked and the credit gate
  // skipped (the run is waived downstream by holdCredits). The slide
  // cap rises only to SYSTEM_SLIDE_CAP - 75 is a hard output-token
  // ceiling, not a tier gate, so an exact request above it still blocks.
  isAdmin?: boolean;
  now?: Date;
}): Promise<PreflightResult> {
  const now = args.now ?? new Date();
  const plan = normalizePlan(args.plan);
  await ensureFresh();
  const baseTier = getTier(plan);
  const tier: TierConfigRow = args.isAdmin
    ? {
        ...baseTier,
        flows: [...ALL_FLOWS],
        unlockedPresetKeys: getActivePresetKeys(),
        slideCap: SYSTEM_SLIDE_CAP,
      }
    : baseTier;
  const balance = await getBalance(args.userId, now);
  const estimate = estimateSlides(args.slideInput);
  const imagesMode = args.imagesMode === true;
  const imageCredits = getImageCredits();
  // Slide cost + image surcharge for a preset at a slide count - the
  // shape every offer below must price with so shown == held.
  const costWithImages = (preset: Quality, slides: number): number =>
    generationCost(preset, slides, creditCostFor) +
    imagesSurcharge(slides, imagesMode, imageCredits);

  const quoteFor = (preset: Quality): PresetQuote => {
    const unlocked = tier.unlockedPresetKeys.includes(preset);
    const quote = quoteGeneration({
      preset,
      flow: args.flow,
      estimate,
      slideCap: tier.slideCap,
      costOf: creditCostFor,
      imagesMode,
      imageCredits,
    });
    return {
      preset,
      effective: quote.effective,
      unlocked,
      credits: unlocked ? quote.holdCredits : null,
      affordable:
        unlocked && (!!args.isAdmin || quote.holdCredits <= balance.total),
    };
  };
  const quotes = getActivePresets().map((p) => quoteFor(p.key));

  if (!tier.flows.includes(args.flow)) {
    // Cheapest tier (ladder order) that unlocks the flow - drives the
    // "{tier}" token in the gate copy.
    const minFlowTier =
      (["free", "plus", "pro", "max"] as const).find((p) =>
        getTier(p).flows.includes(args.flow),
      ) ?? null;
    return { ok: false, plan, balance, reason: "flow_locked", minFlowTier, quotes };
  }
  // Locked if the tier doesn't unlock it OR it's inactive. updatePreset leaves a
  // deactivated key in unlockedPresetKeys, so the active set is the source of
  // truth here too (matching the quotes, the picker, and resolveQuality) rather
  // than relying solely on the upstream resolveQuality coercion.
  if (
    !tier.unlockedPresetKeys.includes(args.preset) ||
    !getActivePresetKeys().includes(args.preset)
  ) {
    return { ok: false, plan, balance, reason: "preset_locked", quotes };
  }
  // An EXACT size above the cap blocks BEFORE generating (enhance is a
  // 1:1 rebuild and knows its page count up front; a stepper above the
  // cap shouldn't reach here, but the server still refuses) - capping
  // an exact count would mean truncation, and we never truncate. A
  // non-exact estimate (word count, data shape) is only the size the
  // deck will be AUTHORED at: clamping it to the cap yields a complete,
  // summarized deck, so it proceeds with the capped quote below.
  if (estimate.exact && estimate.slides !== null && estimate.slides > tier.slideCap) {
    return {
      ok: false,
      plan,
      balance,
      reason: "slide_cap_exceeded",
      slideCap: tier.slideCap,
      quotes,
    };
  }

  const effective = effectivePreset(args.preset, args.flow);
  const quote = quoteGeneration({
    preset: args.preset,
    flow: args.flow,
    estimate,
    slideCap: tier.slideCap,
    costOf: creditCostFor,
    imagesMode,
    imageCredits,
  });

  if (!args.isAdmin && quote.holdCredits > balance.total) {
    // The reduced-slides offer must fit slide cost + image surcharge, so
    // probe downward from the plain-cost affordable count (surcharge only
    // ever pushes the count lower; imagesSurcharge is monotonic in slides).
    let affordable = maxAffordableSlides(effective, balance.total, creditCostFor);
    while (affordable >= MIN_REDUCED_SLIDES && costWithImages(effective, affordable) > balance.total) {
      affordable--;
    }
    const reducedSlides =
      affordable >= MIN_REDUCED_SLIDES
        ? Math.min(affordable, quote.holdSlides)
        : null;
    const cheaperPresets = tier.unlockedPresetKeys.filter((p) => {
      if (p === args.preset) return false;
      // Never suggest an inactive preset: it isn't in the picker, and a direct
      // request gets coerced to the default (resolveQuality). Active-only here
      // keeps it consistent with the quotes + the picker.
      if (!getActivePresetKeys().includes(p)) return false;
      const alt = effectivePreset(p, args.flow);
      return costWithImages(alt, quote.holdSlides) <= balance.total;
    });
    return {
      ok: false,
      plan,
      balance,
      reason: "insufficient_credits",
      options: {
        reducedSlides,
        reducedCredits:
          reducedSlides !== null ? costWithImages(effective, reducedSlides) : null,
        cheaperPresets: [...cheaperPresets],
        topupGap: quote.holdCredits - balance.total,
      },
      quotes,
    };
  }

  return {
    ok: true,
    plan,
    balance,
    holdSlides: quote.holdSlides,
    holdCredits: quote.holdCredits,
    exact: quote.exact,
    cappedToTier:
      estimate.slides !== null && estimate.slides > tier.slideCap,
    quotes,
  };
}
