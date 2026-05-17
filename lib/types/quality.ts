// Generation quality presets. User-picked on /create/summary; flows
// through POST /api/projects → the Inngest event → deck-generate's
// Claude call params (model + thinking + effort). Default is
// "medium" when missing/invalid so any pre-deploy queued job still
// behaves like the current baseline.

export type Quality = "fast" | "medium" | "quality" | "extreme";

export const QUALITY_PRESETS: ReadonlyArray<{
  key: Quality;
  // Arabic label shown on the pill.
  label: string;
  // Rough constants used to estimate ETA to the user. Empirical from
  // observed runs — fast 3 min / 5 slides, medium 4 min, quality 6
  // min, extreme 9 min. These don't drive anything except the muted
  // "~N د" tag on the pill; the actual model params live in
  // QUALITY_TO_API below.
  secsPerSlide: number;
  baseOverheadSecs: number;
}> = [
  { key: "fast",    label: "سريع",  secsPerSlide: 30, baseOverheadSecs: 30 },
  { key: "medium",  label: "متوسط", secsPerSlide: 40, baseOverheadSecs: 60 },
  { key: "quality", label: "عالي",  secsPerSlide: 60, baseOverheadSecs: 120 },
  { key: "extreme", label: "أقصى",  secsPerSlide: 70, baseOverheadSecs: 180 },
];

export const DEFAULT_QUALITY: Quality = "medium";

export function isQuality(value: unknown): value is Quality {
  return (
    value === "fast" ||
    value === "medium" ||
    value === "quality" ||
    value === "extreme"
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
