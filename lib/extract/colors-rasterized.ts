// Phase 17.A — Tier 2 brand-color extraction.
//
// Runs over the rasterized slide PNGs that `lib/extract/rasterize.ts`
// produced. Used as the fallback when:
//   • Input is a PDF (no theme XML to read)
//   • Input is a PPTX with a degenerate theme (e.g. user picked the
//     blank template, no real accent colors set — colors-pptx.ts
//     returns null for those, dispatcher falls through here)
//
// Algorithm: per-slide direct pixel histogram (same shape as the one
// in app/create/brand/page.tsx's screenshot-palette mode), aggregated
// across slides, neutral-filtered, HSL-clustered, top-5.
//
// ─── Why duplicate the algorithm from brand/page.tsx ──────────────
// brand/page.tsx's `extractDominantColors` is coupled to
// `HTMLImageElement` + `document.createElement("canvas")` — browser-
// only APIs that aren't available in Node. Refactoring the brand
// page to use a shared algorithm is a bigger change with real risk
// of breaking the working create-flow brand step (per the
// reuse-existing-components rule: don't touch working code without
// reason). The histogram algorithm here is parallel, NOT a fork —
// keep the two implementations in sync if either evolves. They
// share the same constants (STEP, MIN_RGB_DISTANCE, MIN_PROPORTION)
// and the same accept-loop shape.

import { Image, createCanvas } from "@napi-rs/canvas";

// Match brand/page.tsx's tuning. Coarse enough to collapse anti-
// aliased edges, fine enough to keep distinct hues apart.
const STEP = 16;
const MIN_RGB_DISTANCE = 60;
const MIN_PROPORTION = 0.005; // 0.5 % of pixels per slide
const MAX_ANALYZE_DIM = 800; // downsample large PNGs before histogram

// HSL-clustering thresholds for cross-slide aggregation. Two
// candidates merge when ALL of these are below the deltas — i.e.
// they're the same brand color expressed slightly differently
// across slides (e.g. a button vs a link both using #4F46E5 with
// slightly different surrounding antialiasing).
const CLUSTER_DELTA_H = 15; // degrees
const CLUSTER_DELTA_S = 0.1;
const CLUSTER_DELTA_L = 0.1;

// Top-N to return. Brand page allows up to 6 colors; we return 5 to
// leave room for a brand-mark accent the user may add manually.
const TARGET_COUNT = 5;

type Rgb = [number, number, number];

// ─── Public API ────────────────────────────────────────────────────

/**
 * Extract the top non-neutral brand colors across a set of slide
 * PNGs. Aggregates per-slide histograms, clusters similar HSL
 * neighbors, returns up to TARGET_COUNT hex strings.
 *
 * @param pngBuffers  Rasterized slide PNGs (one per slide).
 * @returns Hex strings like "#4F46E5", ordered by aggregated frequency.
 *   May return fewer than TARGET_COUNT if the deck has few distinct
 *   non-neutral colors (caller's responsibility to provide a default
 *   palette in that case).
 */
export async function extractColorsFromSlides(
  pngBuffers: Buffer[],
): Promise<string[]> {
  // Each slide produces a small list of candidate hex strings with
  // proportions; we aggregate into a single map keyed by hex →
  // total weighted count.
  const aggregated = new Map<string, { rgb: Rgb; weight: number }>();

  for (const png of pngBuffers) {
    const perSlide = await extractDominantColorsFromPng(png);
    for (const candidate of perSlide) {
      if (isNeutral(candidate.rgb)) continue;
      const key = rgbToHex(candidate.rgb);
      const existing = aggregated.get(key);
      if (existing) {
        existing.weight += candidate.weight;
      } else {
        aggregated.set(key, { rgb: candidate.rgb, weight: candidate.weight });
      }
    }
  }

  // Sort by weight desc, then cluster.
  const ranked = [...aggregated.values()].sort((a, b) => b.weight - a.weight);
  const clustered: Array<{ rgb: Rgb; weight: number; hex: string }> = [];

  for (const cand of ranked) {
    const hsl = rgbToHsl(cand.rgb);
    const dupe = clustered.find((c) => {
      const ch = rgbToHsl(c.rgb);
      return (
        Math.abs(hueDistance(hsl[0], ch[0])) < CLUSTER_DELTA_H &&
        Math.abs(hsl[1] - ch[1]) < CLUSTER_DELTA_S &&
        Math.abs(hsl[2] - ch[2]) < CLUSTER_DELTA_L
      );
    });
    if (dupe) {
      // Roll the weight into the existing cluster so the order
      // reflects total occurrence, not first-seen.
      dupe.weight += cand.weight;
      continue;
    }
    clustered.push({ rgb: cand.rgb, weight: cand.weight, hex: rgbToHex(cand.rgb) });
    if (clustered.length >= TARGET_COUNT) break;
  }

  return clustered.map((c) => c.hex);
}

// ─── Per-slide histogram ───────────────────────────────────────────

type SlideCandidate = { rgb: Rgb; weight: number };

/**
 * Same algorithm as app/create/brand/page.tsx's
 * extractDominantColors, adapted to take a PNG buffer instead of
 * an HTMLImageElement. Returns candidates with their proportion-of-
 * slide as the weight (used as aggregation weight upstream).
 */
async function extractDominantColorsFromPng(
  pngBuffer: Buffer,
): Promise<SlideCandidate[]> {
  // Decode the PNG via @napi-rs/canvas's Image class. Same image
  // surface our rasterizer writes to, so the round-trip is lossless.
  const img = new Image();
  img.src = pngBuffer;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
  });

  // Downsample for histogram speed — exact pixel counts don't
  // change the dominant colors and a 1920×1080 PNG decodes into
  // ~8 MB of pixel data. brand/page.tsx caps at 800 too.
  const scale = Math.min(1, MAX_ANALYZE_DIM / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const counts = new Map<string, number>();
  const sums = new Map<string, Rgb>();
  let analyzed = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${Math.floor(r / STEP)},${Math.floor(g / STEP)},${Math.floor(b / STEP)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0];
    s[0] += r;
    s[1] += g;
    s[2] += b;
    sums.set(key, s);
    analyzed += 1;
  }

  if (analyzed === 0) return [];

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out: SlideCandidate[] = [];

  for (const [key, count] of ranked) {
    const proportion = count / analyzed;
    if (proportion < MIN_PROPORTION) break;
    const s = sums.get(key)!;
    const rgb: Rgb = [
      Math.round(s[0] / count),
      Math.round(s[1] / count),
      Math.round(s[2] / count),
    ];
    if (out.some((existing) => rgbDistance(existing.rgb, rgb) < MIN_RGB_DISTANCE)) {
      continue;
    }
    out.push({ rgb, weight: proportion });
    if (out.length >= 8) break; // per-slide cap before aggregation filters more
  }

  return out;
}

// ─── Color utilities ───────────────────────────────────────────────

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function rgbToHex([r, g, b]: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l]; // gray
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      break;
    case gn:
      h = ((bn - rn) / d + 2) * 60;
      break;
    default:
      h = ((rn - gn) / d + 4) * 60;
  }
  return [h, s, l];
}

function hueDistance(a: number, b: number): number {
  // Hue wraps at 360 — distance is the shorter arc.
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * "Neutral" = grays, near-blacks, near-whites that aren't brand
 * intent. Filter applied AFTER per-slide histograms (some neutrals
 * are dominant per-slide because slides have a lot of background)
 * but BEFORE clustering.
 */
function isNeutral(rgb: Rgb): boolean {
  const [, s, l] = rgbToHsl(rgb);
  if (l < 0.08) return true; // near-black
  if (l > 0.92) return true; // near-white
  if (s < 0.1) return true; // gray (low saturation regardless of lightness)
  return false;
}
