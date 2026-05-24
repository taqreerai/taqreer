// Maps a Taqreer quality preset → Anthropic API call parameters.
// Shared between `deck-generate` (full deck) and `deck-regenerate-partial`
// (single-slide redesign) so a partial regen uses the SAME model + thinking
// configuration that produced the original deck. Without the shared helper,
// partial regen hardcoded Opus + adaptive + effort:high — bypassing the
// user's fast/medium/quality choice and burning Opus tokens on decks the
// user explicitly opted out of for cost / speed reasons.
//
// IMPORTANT — `thinking.type.enabled` (with explicit `budget_tokens`) is
// REJECTED at runtime on the 4.x models (claude-opus-4-7, claude-sonnet-4-6)
// with:
//   "thinking.type.enabled is not supported for this model. Use
//    thinking.type.adaptive and output_config.effort to control thinking
//    behavior."
// The SDK type definition advertises ThinkingConfigEnabled but the runtime
// check disagrees — trust the runtime. So the only supported way to vary
// thinking on these models is:
//   • `thinking.type.disabled` — no thinking (fast tier)
//   • `thinking.type.adaptive` + `output_config.effort` — Claude picks the
//     budget, modulated by effort tier (low / medium / high / xhigh / max).
//     `xhigh` is Opus-4.7-exclusive; `max` is unconstrained.
//
// Wall-clock predictability isn't perfect — adaptive can choose long thinking
// on complex prompts. Accepted trade-off, it's the only API-supported path on
// the current models. If runs go long the next lever is dropping a tier or
// trimming the prompt.
//
// Tier-to-model map (2026-05-24 — Sonnet was removed from the thinking
// tiers because Sonnet-low adaptive was unpredictably slow on multi-slide
// JSON tasks; Opus-low reaches the same wall-clock more decisively and the
// quality gap was substantial enough to justify the cost premium on the
// default tier. `fast` stays on Sonnet so short-content drafts and rapid
// iteration cycles don't burn Opus tokens.):
//   fast    → claude-sonnet-4-6 + thinking disabled
//   medium  → claude-opus-4-7   + adaptive + effort:low      (default)
//   quality → claude-opus-4-7   + adaptive + effort:medium
//   extreme → claude-opus-4-7   + adaptive + effort:high

import type { Quality } from "@/lib/types/quality";

export type AnthropicCallParams = {
  model: string;
  thinking: { type: "adaptive" } | { type: "disabled" };
  outputConfig?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
};

export function paramsForQuality(
  quality: Quality | undefined | null,
): AnthropicCallParams {
  switch (quality) {
    // `fast` is the only Sonnet preset — kept as the budget tier so
    // short-content / iterative drafting runs don't pay the Opus
    // premium. All three thinking tiers run on Opus 4.7 (the only
    // way to get adaptive thinking on the 4.x stack; manual
    // `{enabled, budget_tokens}` returns a 400 on Opus 4.7 — see
    // top-of-file comment + docs cross-ref 2026-05-24).
    case "fast":
      return {
        model: "claude-sonnet-4-6",
        thinking: { type: "disabled" },
      };
    case "quality":
      return {
        model: "claude-opus-4-7",
        thinking: { type: "adaptive" },
        outputConfig: { effort: "medium" },
      };
    case "extreme":
      return {
        model: "claude-opus-4-7",
        thinking: { type: "adaptive" },
        outputConfig: { effort: "high" },
      };
    case "medium":
    default:
      return {
        model: "claude-opus-4-7",
        thinking: { type: "adaptive" },
        outputConfig: { effort: "low" },
      };
  }
}
