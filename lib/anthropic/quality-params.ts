// Maps a Taqreer quality preset → Anthropic API call parameters.
// Shared between `deck-generate` (full deck) and `deck-regenerate-partial`
// (single-slide redesign) so a partial regen uses the SAME model + thinking
// configuration that produced the original deck. Without the shared helper,
// partial regen hardcoded Opus + adaptive + effort:high — bypassing the
// user's preset choice and burning Opus tokens on decks the user
// explicitly opted out of for cost / speed reasons.
//
// ─── Expanded preset matrix (2026-05-25) ─────────────────────────
// 11 preset keys, each named by its EXACT API config so the picker
// transparently shows what the run will do:
//   sonnet-fast    → claude-sonnet-4-6 + thinking disabled
//   sonnet-low     → claude-sonnet-4-6 + adaptive + effort:low
//   sonnet-medium  → claude-sonnet-4-6 + adaptive + effort:medium
//   sonnet-high    → claude-sonnet-4-6 + adaptive + effort:high
//   sonnet-max     → claude-sonnet-4-6 + adaptive + effort:max
//   opus-fast      → claude-opus-4-7   + thinking disabled
//   opus-low       → claude-opus-4-7   + adaptive + effort:low   (DEFAULT)
//   opus-medium    → claude-opus-4-7   + adaptive + effort:medium
//   opus-high      → claude-opus-4-7   + adaptive + effort:high
//   opus-xhigh     → claude-opus-4-7   + adaptive + effort:xhigh (Opus-only)
//   opus-max       → claude-opus-4-7   + adaptive + effort:max
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
//   • `thinking.type.disabled` — no thinking (the *-fast keys)
//   • `thinking.type.adaptive` + `output_config.effort` — Claude picks the
//     budget under a ceiling controlled by effort tier
//     (low / medium / high / xhigh / max). `xhigh` is Opus-only — Sonnet
//     returns a 400 on that effort tier. `max` is unconstrained on both.
//
// Wall-clock predictability isn't perfect — adaptive can choose long thinking
// on complex prompts. Accepted trade-off, it's the only API-supported path on
// the current models. If runs go long the next lever is dropping a tier or
// trimming the prompt.
//
// ─── Legacy keys (pre-expansion) ──────────────────────────────────
// The previous Quality union was {"fast" | "medium" | "quality" | "extreme"}.
// Existing Job.quality strings + any pre-deploy queued jobs may still carry
// those values. They flow through this function as `unknown string` (TS
// allows the param at compile time but runtime is wide). The switch's
// `default` branch maps any unrecognised key — including the legacy
// keys — to `opus-low` (the previous `medium` default's exact config),
// so old data resolves to identical API params it would have hit before
// the rename. No DB migration needed.

// Note on the parameter type: we accept `string | undefined | null`
// rather than the strict `Quality` union so legacy Job.quality strings
// (pre-2026-05-25 keys: "fast" / "medium" / "quality" / "extreme") +
// any wire-decoded payload from Inngest events still type-check at the
// call site. The switch's `default` branch maps any unknown key to
// `opus-low`, so the runtime behavior remains safe for any string.

export type AnthropicCallParams = {
  model: string;
  thinking: { type: "adaptive" } | { type: "disabled" };
  outputConfig?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
};

const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-7";

export function paramsForQuality(
  quality: string | undefined | null,
): AnthropicCallParams {
  switch (quality) {
    // ─── Sonnet 4.6 ─────────────────────────────────────────────
    case "sonnet-fast":
      return { model: SONNET, thinking: { type: "disabled" } };
    case "sonnet-low":
      return {
        model: SONNET,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "low" },
      };
    case "sonnet-medium":
      return {
        model: SONNET,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "medium" },
      };
    case "sonnet-high":
      return {
        model: SONNET,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "high" },
      };
    case "sonnet-max":
      return {
        model: SONNET,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "max" },
      };
    // ─── Opus 4.7 ────────────────────────────────────────────────
    case "opus-fast":
      return { model: OPUS, thinking: { type: "disabled" } };
    case "opus-medium":
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "medium" },
      };
    case "opus-high":
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "high" },
      };
    case "opus-xhigh":
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "xhigh" },
      };
    case "opus-max":
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "max" },
      };
    // ─── Default + legacy fallback ──────────────────────────────
    // Catches `opus-low` (the canonical default) AND any legacy
    // quality string from before the 2026-05-25 expansion ("fast",
    // "medium", "quality", "extreme"). All resolve to Opus + adaptive
    // + effort:low — identical to the pre-rename `medium` default,
    // so existing Job rows + queued events behave the same.
    case "opus-low":
    default:
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "low" },
      };
  }
}
