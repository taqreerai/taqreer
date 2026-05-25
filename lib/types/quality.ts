// Generation quality presets. User-picked on /create/summary; flows
// through POST /api/projects → the Inngest event → deck-generate's
// Claude call params (model + thinking + effort).
//
// ─── Expanded preset matrix (2026-05-25) ─────────────────────────
// Each preset is named by its EXACT Anthropic API config — `model`
// (sonnet | opus) + thinking budget tier — so the picker reads as
// "exactly what this run will do" instead of opaque labels like
// "Medium" / "Extreme". 11 configs total:
//   • Sonnet 4.6: fast (no thinking) + adaptive low/medium/high/max
//   • Opus 4.7:   fast (no thinking) + adaptive low/medium/high/xhigh/max
// `xhigh` is Opus-4.7-exclusive — Sonnet returns 400 on that effort tier.
// `max` is unconstrained on both.
//
// Legacy quality values from before this expansion (`"fast"`,
// `"medium"`, `"quality"`, `"extreme"`) are still accepted by
// `paramsForQuality()` via its default branch so old queued jobs +
// stored Job.quality strings still resolve to a valid Claude call.
// The UI and new writes use the expanded keys below.
//
// Default = `opus-low` — matches the behavior of the previous
// `medium` default (Opus 4.7 + adaptive thinking, effort:low).

export type Quality =
  | "sonnet-fast"
  | "sonnet-low"
  | "sonnet-medium"
  | "sonnet-high"
  | "sonnet-max"
  | "opus-fast"
  | "opus-low"
  | "opus-medium"
  | "opus-high"
  | "opus-xhigh"
  | "opus-max";

export const QUALITY_PRESETS: ReadonlyArray<{
  key: Quality;
  // Display label shown in the GenerateSplitButton dropdown. Format:
  // `<Model display> · <effort>` so the user sees the exact API config
  // and can map preset → measured cost in context/pricing.md.
  label: string;
  // Rough constants used to estimate ETA to the user. Sonnet (no
  // thinking) is fastest; Opus with high thinking budgets is slowest.
  // These drive the muted "~N د" tag on the pill — actual model params
  // live in `lib/anthropic/quality-params.ts`. Numbers are educated
  // extrapolations from the small sample we have today; refine as
  // more data lands per `context/pricing.md`.
  secsPerSlide: number;
  baseOverheadSecs: number;
}> = [
  // ─── Sonnet 4.6 (5 configs) ─────────────────────────────────────
  { key: "sonnet-fast",   label: "Sonnet 4.6 · fast",   secsPerSlide: 25, baseOverheadSecs: 20 },
  { key: "sonnet-low",    label: "Sonnet 4.6 · low",    secsPerSlide: 30, baseOverheadSecs: 35 },
  { key: "sonnet-medium", label: "Sonnet 4.6 · medium", secsPerSlide: 35, baseOverheadSecs: 50 },
  { key: "sonnet-high",   label: "Sonnet 4.6 · high",   secsPerSlide: 40, baseOverheadSecs: 70 },
  { key: "sonnet-max",    label: "Sonnet 4.6 · max",    secsPerSlide: 50, baseOverheadSecs: 100 },
  // ─── Opus 4.7 (6 configs) ───────────────────────────────────────
  { key: "opus-fast",     label: "Opus 4.7 · fast",     secsPerSlide: 35, baseOverheadSecs: 40 },
  { key: "opus-low",      label: "Opus 4.7 · low",      secsPerSlide: 40, baseOverheadSecs: 60 },
  { key: "opus-medium",   label: "Opus 4.7 · medium",   secsPerSlide: 50, baseOverheadSecs: 90 },
  { key: "opus-high",     label: "Opus 4.7 · high",     secsPerSlide: 60, baseOverheadSecs: 120 },
  { key: "opus-xhigh",    label: "Opus 4.7 · xhigh",    secsPerSlide: 75, baseOverheadSecs: 160 },
  { key: "opus-max",      label: "Opus 4.7 · max",      secsPerSlide: 95, baseOverheadSecs: 220 },
];

// Default — Opus 4.7 + adaptive low. Matches the behavior of the
// previous `medium` preset (which itself defaulted to Opus low after
// the 2026-05-24 reshuffle that moved Sonnet out of the thinking tiers).
export const DEFAULT_QUALITY: Quality = "opus-low";

export function isQuality(value: unknown): value is Quality {
  return (
    value === "sonnet-fast" ||
    value === "sonnet-low" ||
    value === "sonnet-medium" ||
    value === "sonnet-high" ||
    value === "sonnet-max" ||
    value === "opus-fast" ||
    value === "opus-low" ||
    value === "opus-medium" ||
    value === "opus-high" ||
    value === "opus-xhigh" ||
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
