// Maps a Taqreer quality preset → Anthropic API call parameters.
// Shared between `deck-generate` (full deck) and `deck-regenerate-partial`
// (single-slide redesign) so a partial regen uses the SAME model + thinking
// configuration that produced the original deck.
//
// ─── Collapsed preset matrix (2026-05-25, fifth revision) ───────
// 4 preset keys, each named by its API config:
//
//   sonnet-fast    → claude-sonnet-4-6 + thinking disabled
//   opus-fast      → claude-opus-4-7   + thinking disabled
//   opus-balanced  → claude-opus-4-7   + adaptive + effort:medium  (DEFAULT)
//   opus-max       → claude-opus-4-7   + adaptive + effort:high
//
// Why 4 not 11: Anthropic's published Opus 4.7 pricing ($5/$25 per
// MTok, ~3× cheaper than Opus 4.1) + our measured cost data
// confirmed Opus effort tiers low/medium/high all cost ~$0.83-0.85
// per 8-slide deck. Decision fatigue with no cost or output
// differentiation. The 11-config matrix is documented in
// `context/pricing.md` for reference but not exposed in the menu.
//
// Dropped this revision: opus-xhigh (effort:xhigh).
//   • Docs flag effort:max + structured-output tasks as overthink-
//     prone; xhigh inherits the same risk one tier down.
//   • Measured side-by-side runs: balanced (medium) vs xhigh on the
//     same source PDF produced 24.7 KB vs 36.9 KB HTML (1.5× SVG
//     complexity) at 1.17× cost. Marginal quality difference because
//     the structured JSON skeleton dominates output. Not worth a
//     menu slot.
// Also previously-dropped: opus-extreme (effort:max). It stalled
// with zero thinking-deltas across 3+ test runs on /enhance —
// Anthropic-side issue specific to effort:max + Files API document
// blocks.
//
// IMPORTANT — `thinking.type.enabled` (with explicit `budget_tokens`)
// is REJECTED at runtime on the 4.x models. The only supported way
// to vary thinking on these models is:
//   • `thinking.type.disabled` — no thinking
//   • `thinking.type.adaptive` + `output_config.effort` — Claude
//     picks the budget under a ceiling controlled by effort tier
//     (low / medium / high / xhigh / max)
// `xhigh` is Opus-only. `max` is unconstrained.
//
// ─── Legacy quality values ───────────────────────────────────────
// All previously-shipped Quality keys still flow through this
// function — `paramsForQuality()` accepts `string | undefined |
// null` so legacy `Job.quality` strings type-check at the call site.
// Unrecognised keys (including all previously-dropped variants)
// fall through to the `default` branch and land on the
// `opus-balanced` config, identical to what they'd have run as on
// their original code path. No DB migration needed.
//
// Affected legacy keys (all map to default via this function):
//   • Original Phase 16 ("fast" / "medium" / "quality" / "extreme")
//   • Phase 17.B 11-config expansion (sonnet-low/medium/high/max,
//     opus-low/medium/high/xhigh)
// `sonnet-fast`, `opus-fast`, `opus-balanced`, and `opus-max` are
// the only keys with explicit cases below.

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
    case "sonnet-fast":
      return { model: SONNET, thinking: { type: "disabled" } };
    case "opus-fast":
      return { model: OPUS, thinking: { type: "disabled" } };
    case "opus-max":
      // opus-max — the bounded top tier. Was "max" before the 2026-05-25
      // stall (a 9-slide enhance sat in Anthropic processing for 20+ min
      // returning zero bytes); dropped to "high" alongside the watchdog
      // fix in deck-generate.ts. "high" is fast, predictable, and our
      // earlier notes flagged xhigh/max as empirically indistinguishable
      // on editorial tasks — so this is the user-friendly upper bound.
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "high" },
      };
    // ─── Default + legacy fallback ──────────────────────────────
    // Catches `opus-balanced` (canonical default) AND any legacy
    // quality string from earlier menu shapes. All resolve to Opus
    // + adaptive + effort:medium — the new "balanced" tier.
    case "opus-balanced":
    default:
      return {
        model: OPUS,
        thinking: { type: "adaptive" },
        outputConfig: { effort: "medium" },
      };
  }
}
