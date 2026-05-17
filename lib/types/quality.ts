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
