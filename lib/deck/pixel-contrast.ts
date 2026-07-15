// Pixel-sampled contrast over AMBIGUOUS grounds (photos, gradients, panel
// overlaps, translucent fills) - the measured net the CSS contrast walk
// cannot provide there (2026-07-15).
//
// WHY: a real deck shipped a rose-on-rose lead paragraph over a photo bg
// (measured Manhattan 49, WCAG 1.03:1 - literally invisible) and BOTH nets
// missed it: the CSS contrast audit skips photo grounds by design (CSS can't
// know the pixels), and the vision reviewer cannot see text that isn't
// visible - catching it from a screenshot alone requires noticing that code
// lists a paragraph the image doesn't show. Measurement over the RENDERED
// pixels closes the hole: the bake already screenshots every pending slide
// for the vision reviewer, so we sample that EXISTING buffer - zero extra
// captures, no DOM mutation.
//
// Glyph contamination (the shot has the text painted on it) is handled by a
// TWO-STAGE verdict, validated on the incident deck:
//   1. ground = median of ALL samples. Glyphs are minority pixels in a text
//      box (10-35% coverage even for bold display type), and a median is
//      robust to <50% contamination - so the untrimmed median IS the ground.
//      dist >= 60 -> legible, done. (Glyph pull only ever shrinks the
//      distance, so a far median is safely far.)
//   2. dist < 60 -> probably invisible, UNLESS it's the rare big-glyph
//      illusion (huge ultra-bold text covering >50% of its box pulls the
//      median onto the glyphs). Escape hatch: if a substantial share of
//      samples sits far from the ink AND their median is CLEARLY legible
//      (>= 110), the box is glyph-dominated but readable -> clean.
//   An ink-aware TRIM-FIRST approach was tried and had a blind band: for
//   marginal-invisible text (ground 45-60 from ink) the trim ate the ground
//   pixels themselves, leaving only far texture outliers - measured legible
//   at the exact distances that matter most.
//
// Threshold mirrors the CSS path: Manhattan RGB distance < 60 = INVISIBLE.
// Findings ride the existing loop: measured finding -> the vision MUST
// revise (or dispute) -> the regression guard re-samples the revision.

import sharp from "sharp";
import type {
  FrameAuditFinding,
  PixelContrastCheck,
} from "@/lib/deck/audit-script";

// Sample grid per text box: dense enough to survive photo texture, cheap
// enough to be negligible (<=300 reads per box).
const GRID_X = 30;
const GRID_Y = 10;
// Samples beyond this Manhattan distance of the ink count as clearly-not-
// glyph pixels for the big-glyph escape hatch.
const INK_NEAR = 45;
// The escape hatch fires only when at least this share of samples is
// clearly-not-glyph AND their median is unambiguously legible.
const FAR_SHARE = 0.25;
const CLEARLY_LEGIBLE = 110;
// Same law as the CSS contrast path in audit-script.ts.
const INVISIBLE_DIST = 60;
// Same per-slide finding cap as the CSS path.
const MAX_FINDINGS = 6;

export type PixelContrastMeasurement = {
  check: PixelContrastCheck;
  // Sampled effective ground (median). Null when the box was unmeasurable
  // (mostly off-shot).
  ground: [number, number, number] | null;
  // Manhattan ink-vs-ground distance; Infinity when unmeasurable.
  dist: number;
  invisible: boolean;
};

const dist3 = (a: [number, number, number], b: [number, number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Measure each candidate text box against the slide's rendered screenshot.
 * `png` is the full-slide shot clipped to the [data-slide-id] host box -
 * exactly what the check rects are relative to (CSS px; the render runs at
 * dsf 1, but the scale factor is derived from the buffer for robustness).
 * Never throws: a decode/sampling fault returns [] (the CSS findings and the
 * vision pass still run - same degrade-not-fail contract as the audit).
 */
export async function measurePixelContrast(
  png: Buffer,
  hostCssWidth: number,
  checks: PixelContrastCheck[],
): Promise<PixelContrastMeasurement[]> {
  if (checks.length === 0) return [];
  try {
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = hostCssWidth > 0 ? info.width / hostCssWidth : 1;
    const out: PixelContrastMeasurement[] = [];
    for (const c of checks) {
      const samples: [number, number, number][] = [];
      for (let sy = 0; sy < GRID_Y; sy++) {
        for (let sx = 0; sx < GRID_X; sx++) {
          const px = Math.round((c.x + ((sx + 0.5) * c.w) / GRID_X) * scale);
          const py = Math.round((c.y + ((sy + 0.5) * c.h) / GRID_Y) * scale);
          if (px < 0 || py < 0 || px >= info.width || py >= info.height) {
            continue;
          }
          const off = (py * info.width + px) * 3;
          samples.push([data[off], data[off + 1], data[off + 2]]);
        }
      }
      if (samples.length < 20) {
        out.push({ check: c, ground: null, dist: Infinity, invisible: false });
        continue;
      }
      const medOf = (arr: [number, number, number][]) =>
        [0, 1, 2].map(
          (i) =>
            arr.map((s) => s[i]).sort((a, b) => a - b)[
              Math.floor(arr.length / 2)
            ],
        ) as [number, number, number];
      // Stage 1: untrimmed median = the ground (glyphs are minority pixels).
      const ground = medOf(samples);
      let dist = dist3(ground, c.ink);
      if (dist < INVISIBLE_DIST) {
        // Stage 2: big-glyph escape hatch - a box >50% covered by legible
        // display glyphs pulls the median onto the ink; if the clearly-not-
        // glyph samples are substantial and CLEARLY legible, it's readable.
        const far = samples.filter((s) => dist3(s, c.ink) > INK_NEAR);
        if (
          far.length >= samples.length * FAR_SHARE &&
          dist3(medOf(far), c.ink) >= CLEARLY_LEGIBLE
        ) {
          dist = INVISIBLE_DIST; // legible
        }
      }
      out.push({ check: c, ground, dist, invisible: dist < INVISIBLE_DIST });
    }
    return out;
  } catch (err) {
    console.warn(
      "[pixel-contrast] sampling failed, skipping:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * The observe-step wrapper: measurements -> `contrast` findings for the
 * invisible boxes (capped, same detail shape as the CSS contrast path).
 */
export async function samplePixelContrast(
  png: Buffer,
  hostCssWidth: number,
  checks: PixelContrastCheck[],
): Promise<FrameAuditFinding[]> {
  const measured = await measurePixelContrast(png, hostCssWidth, checks);
  const findings: FrameAuditFinding[] = [];
  for (const m of measured) {
    if (!m.invisible || findings.length >= MAX_FINDINGS) continue;
    findings.push({
      type: "contrast",
      detail:
        `INVISIBLE TEXT over a photo/scrim ground (pixel-measured): ${m.check.tag}` +
        ` "${m.check.snippet}" color rgb(${m.check.ink.join(",")}) on rendered ground` +
        ` rgb(${(m.ground ?? m.check.ink).join(",")})` +
        ` - set a strongly contrasting color explicitly on this element` +
        ` (the scrim/photo behind it does not provide the contrast)`,
    });
  }
  return findings;
}

/**
 * Deterministic backstop ink for a still-invisible text box: the theme
 * palette color FARTHEST from the sampled ground, provided it is decisively
 * legible; else near-black / warm-white by ground luminance. Mirrors the
 * leading-normalizer philosophy: the vision gets first shot at a design-
 * quality fix, the system GUARANTEES the outcome when that fails.
 */
export function backstopInk(
  ground: [number, number, number],
  palette: string[],
): string {
  let best: string | null = null;
  let bestDist = 0;
  for (const hex of palette) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) continue;
    const rgb: [number, number, number] = [
      parseInt(m[1].slice(0, 2), 16),
      parseInt(m[1].slice(2, 4), 16),
      parseInt(m[1].slice(4, 6), 16),
    ];
    const d = dist3(rgb, ground);
    if (d > bestDist) {
      bestDist = d;
      best = `#${m[1]}`;
    }
  }
  if (best && bestDist >= 180) return best;
  // No palette color is decisively legible on this ground - fall back to
  // near-black / warm-white by ground luminance.
  const lum = 0.2126 * ground[0] + 0.7152 * ground[1] + 0.0722 * ground[2];
  return lum >= 128 ? "#141218" : "#FAF7F2";
}
