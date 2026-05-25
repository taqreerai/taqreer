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
// Menu (key → API config → label shown to user):
//   sonnet-fast    → claude-sonnet-4-6 + thinking disabled              "Sonnet 4.6 · fast"
//   opus-fast      → claude-opus-4-7   + thinking disabled              "Opus 4.7 · fast"
//   opus-balanced  → claude-opus-4-7   + adaptive + effort:medium       "Opus 4.7 · medium"     (DEFAULT)
//   opus-max       → claude-opus-4-7   + adaptive + effort:high         "Opus 4.7 · high"
//
// Labels mirror Anthropic's documented effort-tier names verbatim
// (medium / high) so the menu surfaces the actual knob rather
// than product-side aliases. Keys stay stable for already-shipped
// tiers (opus-balanced / opus-max) so legacy Job rows still
// resolve to the same API config via paramsForQuality().
//
// ─── What got dropped (2026-05-25) ────────────────────────────────
// • Sonnet adaptive variants (sonnet-low/medium/high/max) — verified
//   broken-slow on multi-slide JSON (sonnet-low test sat in thinking
//   10+ min on a 9-slide enhance with no text emitted).
// • Opus effort tiers low / high / xhigh — collapsed into `balanced`
//   (effort:medium). Cost data showed no meaningful differentiation
//   between low/medium/high on our task. xhigh and max were
//   indistinguishable in early tests; kept `max` as the headline
//   "go deep" option.
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

export type Quality =
  | "sonnet-fast"
  | "opus-fast"
  | "opus-balanced"
  | "opus-max";

export const QUALITY_PRESETS: ReadonlyArray<{
  key: Quality;
  // Display label shown in the GenerateSplitButton dropdown. Format:
  // `<Model display> · <effort>` so the user sees the exact API config
  // and can map preset → measured cost in context/pricing.md.
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
}> = [
  // Labels mirror Anthropic's effort-tier names verbatim
  // (medium / high / max — see /docs/en/build-with-claude/effort)
  // so the menu reads as a direct knob over the API config rather
  // than inventing product-side aliases ("balanced", "extreme", etc.)
  // that obscured what was actually being requested. Keys stay
  // stable so existing Job rows storing legacy `quality` strings
  // still resolve to the same API config via paramsForQuality().
  { key: "sonnet-fast",    label: "Sonnet 4.6 · fast",     thinking: false, secsPerSlide: 15, baseOverheadSecs: 15 },
  { key: "opus-fast",      label: "Opus 4.7 · fast",       thinking: false, secsPerSlide: 20, baseOverheadSecs: 30 },
  { key: "opus-balanced",  label: "Opus 4.7 · medium",     thinking: true,  secsPerSlide: 25, baseOverheadSecs: 60 },
  { key: "opus-max",       label: "Opus 4.7 · high",       thinking: true,  secsPerSlide: 40, baseOverheadSecs: 90 },
];

// Default — Opus 4.7 + adaptive medium thinking. The "balanced"
// tier: enough thinking for the editorial-deck task without the
// runtime tail of `max`. New default after the 2026-05-25 collapse
// from 7 → 4 presets.
export const DEFAULT_QUALITY: Quality = "opus-balanced";

export function isQuality(value: unknown): value is Quality {
  return (
    value === "sonnet-fast" ||
    value === "opus-fast" ||
    value === "opus-balanced" ||
    value === "opus-max"
  );
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

// Auto slide-count from raw input text. Used when the user opts out of
// picking an explicit count (`slideCountMode: "auto"` on /create/summary)
// — instead of letting Claude pick "somewhere in 8–12" the brief carries
// an exact count derived from the input length.
//
// Formula:
//   words      = whitespace-tokenized count, with stray punctuation
//                stripped so "x." and "y!" don't inflate the count
//   per_slide  = 100 words is a comfortable editorial slide density
//                (room for a headline + 2–3 short paragraphs or a
//                stat block). Lower density reads padded; higher
//                density overflows on RTL.
//   content    = ceil(words / per_slide), floored at 3 so we always
//                have a real middle even on tiny inputs
//   total      = content + 2 — one slide reserved for the cover,
//                one for the closing / thank-you frame
//   clamp      = [5, 20] so we never go below "cover + 3 body +
//                closing" and never balloon past a sensible upper
//                bound (Sonnet starts dropping quality past ~20)
//
// Returns null when the text is empty / whitespace-only — caller
// should fall back to its own default (typically 8).
export function estimateSlideCountFromText(text: string | null | undefined): number | null {
  if (!text || typeof text !== "string") return null;
  const cleaned = text
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  const words = cleaned.split(" ").filter(Boolean).length;
  if (words === 0) return null;
  const PER_SLIDE = 100;
  const contentSlides = Math.max(3, Math.ceil(words / PER_SLIDE));
  const total = contentSlides + 2;
  return Math.max(5, Math.min(20, total));
}
