// Maps a Taqreer quality preset → Anthropic API call parameters.
// Shared between `deck-generate` (full deck) and `deck-regenerate-partial`
// (single-slide redesign) so a partial regen uses the SAME model + thinking
// configuration that produced the original deck.
//
// ─── Collapsed preset matrix (2026-05-29, sixth revision) ───────
// 3 active preset keys, each named by its API config:
//
//   sonnet-fast    → claude-sonnet-4-6 + thinking disabled
//   opus-fast      → claude-opus-4-8   + thinking disabled
//   opus-balanced  → claude-opus-4-8   + adaptive + effort:low     (DEFAULT)
//   (opus-max retired 2026-05-29 — effort:high path removed; the key
//    now falls through to the `low` default below.)
//
// Why 3 not 11: Opus 4.8 pricing ($5/$25 per MTok, unchanged from
// 4.7, ~3× cheaper than Opus 4.1) + our measured cost data
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
//   • opus-max — menu-retired 2026-05-29; its explicit case was
//     removed, so it now lands on the default too.
// `sonnet-fast`, `opus-fast`, and `opus-balanced` are the only keys
// with explicit cases below; everything else hits the default.

import { paramsForPreset } from "@/lib/config/runtime-config";
import type { ThinkingOff } from "@/lib/anthropic/model-thinking";

export type AnthropicCallParams = {
  model: string;
  thinking: { type: "adaptive" } | ThinkingOff;
  outputConfig?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
  // Per-model output ceiling. Haiku 4.5 rejects requests above 64k
  // output tokens (API 400: "max_tokens: 128000 > 64000"); Sonnet/Opus
  // take 128k. The deck stream passes this straight to max_tokens.
  maxTokens: number;
};

// Active preset model ids live in the DB now (lib/config/runtime-config.ts) +
// the seed. This single constant backs only the legacy/cold fallback below.
const FALLBACK_OPUS = "claude-opus-5-5";

// Fallback = the canonical default (opus-balanced: Opus 4.8 + adaptive +
// effort:low), matching the prior `default` branch. Used when the key is null,
// unknown, or a retired legacy key (opus-max, and the menu-dropped haiku-fast /
// sonnet-fast which used to have explicit cases). Pre-launch decks are
// disposable and every regen path forces opus-fast, so a legacy key is never
// reprocessed in practice; this is purely a safety net.
const FALLBACK_PARAMS: AnthropicCallParams = {
  model: FALLBACK_OPUS,
  thinking: { type: "adaptive" },
  outputConfig: { effort: "low" },
  maxTokens: 128000,
};

// Maps a quality preset key → Anthropic call params, sourced from the DB-backed
// runtime config (admin-editable). Unknown/legacy keys fall back to the default.
// Same name + signature as before, so every call site (deck-generate, partial
// regen) is unchanged. Callers should `await ensureFresh()` once upstream so the
// snapshot is current; this stays sync because it runs inside the Inngest step.
export function paramsForQuality(
  quality: string | undefined | null,
): AnthropicCallParams {
  return paramsForPreset(quality) ?? FALLBACK_PARAMS;
}

/** True when the preset runs a Haiku model (no vision review; see deck-generate). */
export function isHaikuQuality(quality: string | undefined | null): boolean {
  return paramsForQuality(quality).model.startsWith("claude-haiku");
}

/**
 * True when frameSystemPrompt appends the LAYOUT CHECKLIST: the Haiku and Sonnet
 * presets (2026-10-15). Their layouts leave dead zones and half-empty cards (the
 * review pass revises 37% of Sonnet slides, 56% of those for dead space), which
 * Opus does not. Opus prompts stay byte-identical, so their cache is untouched.
 */
export function usesLayoutRules(quality: string | undefined | null): boolean {
  const model = paramsForQuality(quality).model;
  return model.startsWith("claude-haiku") || model.startsWith("claude-sonnet");
}
