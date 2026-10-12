// Generation quality presets. User-picked on /create/summary; flows
// through POST /api/projects → the Inngest event → deck-generate's
// Claude call params (model + thinking + effort).
//
// ─── Collapsed preset matrix (2026-05-25, fifth revision) ─────────
// 4 configs. opus-xhigh (effort:xhigh) dropped this revision after
// docs + data both pointed against it for our task:
//
//   • Anthropic docs explicitly flag effort:max as overthink-prone on
//     "structured-output or less intelligence-sensitive tasks" — and
//     our deck generation is structured output (Zod-validated JSON
//     manifest). xhigh inherits the same overthink risk one tier
//     down.
//   • Measured side-by-side runs on the same source PDF:
//     opus-balanced (medium) — 24.7 KB HTML, 4 svg, 14 paths, ~$2.58
//     opus-xhigh   (xhigh)  — 36.9 KB HTML, 6 svg, 28 paths, ~$3.03
//     1.5× SVG complexity, 1.17× cost, marginal quality difference
//     because the structured JSON skeleton dominates output. Not
//     worth a menu slot.
//
// Menu (key → API config → label shown to user) — 3 presets:
//   sonnet-fast    → claude-sonnet-4-6 + thinking disabled    "Sonnet · سريع"
//   opus-fast      → claude-opus-4-8   + thinking disabled    "Opus · سريع"
//   opus-balanced  → claude-opus-4-8   + adaptive + effort:low  "Opus · تفكير"  (DEFAULT, green thinking chip)
//
// Two no-thinking "سريع" options (Sonnet cheapest, Opus stronger) +
// one light-thinking "تفكير" option. The deep tier (opus-max,
// effort:high) was removed entirely 2026-05-29: on Opus 4.8 it
// over-thought this structured-deck task (a 5-slide deck ran 16 min
// / $1.69) with no quality gain over `low`. Any legacy `opus-max`
// Job row still resolves — paramsForQuality takes a raw string and
// falls through to the `low` default — so no DB migration is needed.
//
// ─── What got dropped (2026-05-25) ────────────────────────────────
// • Sonnet adaptive variants (sonnet-low/medium/high/max) — verified
//   broken-slow on multi-slide JSON (sonnet-low test sat in thinking
//   10+ min on a 9-slide enhance with no text emitted).
// • Opus effort tiers low / high / xhigh — collapsed into `balanced`
//   (effort:low as of 2026-05-29). Cost data showed no meaningful
//   differentiation between low/medium/high on our task; the deep
//   `opus-max` (effort:high) option was removed entirely 2026-05-29
//   (over-thinks on Opus 4.8 — 16 min/$1.69 for 5 slides — no quality
//   gain over `low`).
//
// ─── Legacy compatibility ─────────────────────────────────────────
// All previous Quality keys are accepted at the runtime layer and
// fall through to `opus-balanced`-equivalent params via the default
// branch in `paramsForQuality()`. No DB migration needed. Affected
// legacy keys:
//   • Original 4 ("fast" / "medium" / "quality" / "extreme")
//   • Phase 17.B-expansion 11 (sonnet-low/medium/high/max,
//     opus-low/medium/high/xhigh)
// All resolve to opus + adaptive + effort:low at runtime (which is
// what they did before the collapse — identical behavior, just no
// longer exposed as picker options).
//
// Default = `opus-balanced` — the new mid-tier sweet spot.

// ─── 2026-06-12 collapse: ALL-OPUS lineup (+ Fable test tier) ──────
// Measured same-day, same 5-slide brief, thinking-off:
//   opus-fast   53s  ~$0.10  disciplined editorial design
//   sonnet-fast 5-20min  $0.35-1.45  erratic (draft pathology, slow)
//   haiku-fast  25s  ~$0.02  Word-doc plain (no design)
// opus-fast beats sonnet on speed AND cost AND quality, and haiku's
// output undersells the product - both dropped from the menu (keys
// stay legacy-resolvable in paramsForQuality, existing decks regen
// fine). fable-low (Claude Fable 5 + adaptive low) added as the
// experimental top tier to baseline cost/quality.
// Relaxed from a literal union to `string`: preset keys are DB-driven now
// (lib/config/runtime-config.ts). The active set is QUALITY_PRESETS below
// (a bundled client snapshot, kept in sync with the seed) on the client, and
// getActivePresets() on the server. Any stored Job.quality still type-checks.
export type Quality = string;

export const QUALITY_PRESETS: ReadonlyArray<{
  key: Quality;
  // Display label shown in the GenerateSplitButton dropdown - bare
  // model name; the fast/thinking distinction renders as a PILL next
  // to it (user direction 2026-06-12), never as a label suffix.
  label: string;
  // Whether the preset uses adaptive extended thinking. Drives the
  // little "thinking" / "no thinking" chip rendered next to the label
  // in the dropdown, so the user can spot at a glance which presets
  // pay the thinking-budget surcharge AND wait-time. Matches the
  // `thinking.type` in `paramsForQuality()` for each preset.
  thinking: boolean;
  // Rough constants used to estimate ETA to the user. Sonnet (no
  // thinking) is fastest; Opus with high thinking budgets is slowest.
  // These drive the muted "~N د" tag on the pill — actual model params
  // live in `lib/anthropic/quality-params.ts`. Numbers are tuned against
  // measured runs on the /enhance flow (2026-05-25 calibration pass):
  // opus-max on a 9-slide deck ran ~5–9 min wallclock; previous numbers
  // (95/220 → 18 min estimate) were ~2× too high. New constants land
  // closer to measured wallclock while keeping a small safety margin so
  // we don't under-promise.
  secsPerSlide: number;
  baseOverheadSecs: number;
  // Mirrors the seed's Preset.active: an inactive preset stays
  // legacy-resolvable (params/cost lookups work) but never renders in
  // the pre-hydration picker fallback. Kept in sync with SEED_PRESETS
  // (asserted by scripts/check-config-parity.ts).
  active: boolean;
  // Adaptive-thinking effort tier (null when thinking is off). Mirrors the
  // seed; drives the 3-level design-quality chip (draft/standard/premium).
  effort: string | null;
}> = [
  // Labels are intent-based Arabic (سريع = fast / no thinking,
  // تفكير = thinking) — the distinction users care about is "does it
  // reason or not", not the raw effort knob. The green thinking chip
  // (driven by `thinking`) marks the تفكير preset. Keys stay stable
  // so legacy Job rows still resolve via paramsForQuality().
  // 3 presets: two no-thinking "سريع" options (Sonnet cheapest, Opus
  // stronger) + one light-thinking "تفكير" option (green thinking
  // chip, driven by `thinking: true`). opus-max (effort:high) was
  // retired from the menu 2026-05-29.
  // ETA constants re-baselined on the 2026-06-12 measured run:
  // opus-fast streamed a 5-slide deck in 53s wall.
  // Sonnet restructure 2026-07-21: Sonnet 5 is the new free/entry model
  // (measured this session ~40-57% cheaper than opus-fast, comparable design,
  // no draft pathology). Opus is subscription-gated; opus-medium retired.
  { key: "sonnet-fast",    label: "Sonnet 5.5", thinking: false, effort: null,     secsPerSlide: 6,  baseOverheadSecs: 20, active: true },
  { key: "opus-fast",      label: "Opus 5.5", thinking: false, effort: null,     secsPerSlide: 8,  baseOverheadSecs: 25, active: true },
  { key: "opus-balanced",  label: "Opus 4.8", thinking: true,  effort: "low",    secsPerSlide: 25, baseOverheadSecs: 60, active: true },
  // Fable-for-Max 2026-07-21: reactivated as the Max-exclusive top tier
  // ("احترافي" / Professional). Fable requires thinking on.
  { key: "fable-low",      label: "Fable 5.1", thinking: true,  effort: "low",    secsPerSlide: 20, baseOverheadSecs: 45, active: true },
  // Retired 2026-07-21 (no measurable quality gain over opus-balanced); kept
  // inactive so legacy opus-medium decks still resolve.
  { key: "opus-medium",    label: "Opus 4.8", thinking: true,  effort: "medium", secsPerSlide: 25, baseOverheadSecs: 60, active: false },
];

// Default — `sonnet-fast` (Sonnet restructure 2026-07-21): the entry model,
// unlocked for every tier, so it's a safe global default. Opus is one click
// away for paid tiers.
export const DEFAULT_QUALITY: Quality = "sonnet-fast";

// Quality used by ALL regen paths (partial-regen, per-slide regen, full
// regenerate). Regens are quick scoped edits, so they always run on the
// fastest available preset (Opus 4.8, no thinking) rather than inheriting the
// deck's original quality — which also dodges access-gated presets like Fable 5
// ("not available" 404s) that a deck may have been generated with.
export const REGEN_QUALITY: Quality = "opus-fast";

// Client-safe validity check against the bundled snapshot. Server routes that
// must honour DB-added presets validate against getActivePresetKeys() instead.
export function isQuality(value: unknown): value is Quality {
  return typeof value === "string" && QUALITY_PRESETS.some((p) => p.key === value);
}

// Compute the estimated total wall-clock for a tier given a slide
// count. Slide count comes from the brief's resolved count or
// defaults to 8 (the prompt's "auto" target).
export function estimateMinutes(quality: Quality, slideCount: number): number {
  const preset = QUALITY_PRESETS.find((p) => p.key === quality);
  if (!preset) return 0;
  const totalSecs = preset.baseOverheadSecs + preset.secsPerSlide * slideCount;
  return Math.max(1, Math.round(totalSecs / 60));
}

// (The word-count auto slide estimator was DELETED 2026-07-18, owner ruling:
// auto slide count is the MODEL's decision - it lowballed structured content
// (an explicit 8-slide carousel script estimated 5 by word count). The system
// now only hard-caps by tier slide cap + affordable credits; see
// lib/credits/cost.ts estimateSlides "unknown" + the ceiling brief mode.)
