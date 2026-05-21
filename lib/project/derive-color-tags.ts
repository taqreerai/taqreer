// Color-tag derivation for /projects swatch picker.
//
// Input: the brief's brand colors array (whatever the user picked on
// /create/brand — could be empty if they left Claude to decide).
// Optional fallback: the generated manifest's theme.brand.colors so
// Claude-decides decks still get tagged.
// Output: a stable list of hex tags written to `Project.colorTags`.
//
// Rules (locked 2026-05-21):
//   1. Classify each palette entry in HSL space:
//        saturation > SAT_MIN                      → chromatic
//        saturation ≤ SAT_MIN AND L < LIGHT_MIN    → black
//        saturation ≤ SAT_MIN AND L > LIGHT_MAX    → white
//        else (mid-greyscale)                      → grey
//   2. If ANY chromatic exists, the deck identifies as those colors —
//      drop b/w/grey palette siblings (they're chrome, not identity).
//   3. If the palette is entirely greyscale, tag the deck with BOTH
//      #000000 AND #FFFFFF so it surfaces under either filter (user's
//      mental model: "neutral decks should match black AND white").
//   4. Empty palette → fall back to manifest theme colors (same rules
//      apply). Empty after fallback → last-resort ["#000000",
//      "#FFFFFF"].
//
// Thresholds are conservative — `#03030D` (the app's near-black bg)
// has L ≈ 0.025, well under LIGHT_MIN; `#FAFAFA`-ish whites cross
// LIGHT_MAX cleanly. If a brand picks a `#222` "dark grey" as their
// primary, that lands as `grey` (mid lightness, low saturation),
// gets dropped if there's a chromatic accent, and gets the b/w
// double-tag if not — matches the design intent either way.

const SAT_MIN = 0.15;
const LIGHT_MIN = 0.1;
const LIGHT_MAX = 0.9;

type ColorKind = "chromatic" | "black" | "white" | "grey";

// ─── 10-color filter bucket taxonomy ───
// The /projects swatch picker maps every `colorTags` entry into one
// of these ten canonical buckets so users see a small, predictable
// palette instead of every individual brand hex. Underlying
// `colorTags` in the DB stay as the deck's actual brand colours —
// bucketing happens only at display + filter time, so we can
// re-tune the taxonomy without a backfill.
//
// Order matters: this is the order the swatches render in the
// strip. Chromatics first (rainbow-ish — red, orange, brown, yellow,
// green, blue, purple), then neutrals (grey, black, white).
//
// The hex values are mid-saturation Tailwind-palette-aligned tones
// — recognisable as "the red bucket" / "the blue bucket" etc.
export const COLOR_BUCKETS = [
  "#EF4444", // red
  "#F97316", // orange
  "#92400E", // brown   (dark warm — amber-800)
  "#EAB308", // yellow
  "#22C55E", // green
  "#3B82F6", // blue    (also catches cyan/teal — hue 165–285)
  "#A855F7", // purple  (also catches pink/magenta — hue 265–345; using
             // Tailwind purple-500 instead of violet-500 since
             // violet-500 itself is hue ~258 — borderline blue
             // visually and lives in the BLUE bucket under the
             // 265° cutoff)
  "#9CA3AF", // grey    (mid-lightness low-saturation)
  "#000000", // black
  "#FFFFFF", // white
] as const;

// Maps a hex to the set of buckets it perceptually belongs to.
// Returns 1-2 buckets — most colors land cleanly in one, but
// colors near a hue boundary appear in BOTH adjacent buckets so
// the filter UX matches how humans perceive ambiguity ("almost a
// purple" → show under blue AND purple, not strictly one).
//
// Classification order:
//   1. Lightness/saturation gates (black / white / grey / brown)
//      are SHARP — there's no perceptual ambiguity between "is
//      this black or red" at l=0.05. Single bucket only.
//   2. Chromatic hue is FUZZY — each bucket's hue range gets
//      extended by ±HUE_FUZZ at each boundary. A color whose hue
//      sits in the overlap zone lands in BOTH adjacent buckets.
//      Caught the `#630EE1` (h=264.2°) case where the original
//      sharp 265° cutoff put it in blue only, even though it's
//      visually right between blue and purple.
//
// Returns COLOR_BUCKETS entries (canonical hexes). Dedupe + order
// in the caller's swatch picker.
// Hue fuzz tuned against the user's actual library 2026-05-21:
//   • ±10° was too generous — a `#D4C1E5` lavender (5° past purple)
//     and a `#F4DC0B` yellow (9° past orange) both leaked into the
//     wrong neighbouring bucket, making "all decks appear under
//     all colors."
//   • ±3° keeps the boundary-overlap UX (e.g. `#630EE1` at h=264°,
//     1° below the purple cutoff, still shows up under BOTH blue
//     AND purple) while keeping anything more than 3° past a
//     boundary firmly in its own bucket.
const HUE_FUZZ = 3;
type HueRange = { color: string; min: number; max: number; wraps?: boolean };
const HUE_RANGES: HueRange[] = [
  { color: "#EF4444", min: 345, max: 15, wraps: true }, // red (wraps 0)
  { color: "#F97316", min: 15, max: 45 },               // orange
  { color: "#EAB308", min: 45, max: 75 },               // yellow
  { color: "#22C55E", min: 75, max: 165 },              // green
  { color: "#3B82F6", min: 165, max: 265 },             // blue (incl. cyan)
  { color: "#A855F7", min: 265, max: 345 },             // purple (incl. pink)
];

function hueInRange(h: number, r: HueRange, fuzz: number): boolean {
  const min = r.min - fuzz;
  const max = r.max + fuzz;
  if (r.wraps) {
    // Red wraps 0 — range is [345, 360) ∪ [0, 15). With fuzz, also
    // [335, 360) ∪ [0, 25). Two segments to check.
    return h >= min || h < max;
  }
  return h >= min && h < max;
}

export function bucketize(hex: string): string[] {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return ["#000000"]; // defensive
  const { h, s, l } = hexToHsl(hex.toUpperCase());
  // Sharp gates (no perceptual ambiguity at these extremes).
  if (l < LIGHT_MIN) return ["#000000"];
  if (l > LIGHT_MAX) return ["#FFFFFF"];
  if (s < SAT_MIN) return ["#9CA3AF"]; // grey
  // Brown — warm hue that's EITHER dark OR muted. Sharp gate too:
  // a cream is unambiguously brown-family, not "almost orange and
  // almost brown." Single bucket.
  if (h >= 15 && h < 50 && (l < 0.45 || s < 0.5)) return ["#92400E"];

  // Chromatic hue — fuzzy. Walk every range; collect every one
  // whose extended range contains h. In practice a color lands in
  // 1 (core of a band) or 2 (boundary zone) buckets.
  const out: string[] = [];
  for (const r of HUE_RANGES) {
    if (hueInRange(h, r, HUE_FUZZ)) out.push(r.color);
  }
  // Defensive fallback — if the ranges somehow missed h (impossible
  // when covering 0-360 contiguously, but defensive against bad
  // input). Return red as the wrap-around catch.
  return out.length > 0 ? out : ["#EF4444"];
}

// Pure (testable) function — no Prisma access. Imported by
// deck-generate.ts at job-completion time and by the backfill script.
export function deriveColorTags(
  brandColors: readonly string[],
  manifestThemeColors: readonly string[] = [],
): string[] {
  const fromBrand = classifyAndPick(brandColors);
  if (fromBrand.length > 0) return fromBrand;
  const fromManifest = classifyAndPick(manifestThemeColors);
  if (fromManifest.length > 0) return fromManifest;
  // Last resort — deck has no colour signal at all. Surface it under
  // both neutral filters so it isn't invisible in the swatch picker.
  return ["#000000", "#FFFFFF"];
}

function classifyAndPick(palette: readonly string[]): string[] {
  const valid = palette
    .map((c) => (typeof c === "string" ? c.toUpperCase() : null))
    .filter((c): c is string => c !== null && /^#[0-9A-F]{6}$/.test(c));
  if (valid.length === 0) return [];

  const classified = valid.map((hex) => ({ hex, kind: classify(hex) }));
  const chromatic = classified
    .filter((c) => c.kind === "chromatic")
    .map((c) => c.hex);

  // Dedupe by hex — same accent listed twice would create duplicate
  // swatches downstream. Order-preserving.
  if (chromatic.length > 0) return uniq(chromatic);

  // Greyscale-only palette → emit both poles. We don't pass through
  // the actual hex values picked (the user might have picked #111 or
  // #EEE — the swatch picker wants the canonical greyscale tokens
  // so all "dark-mode" decks collapse onto one black swatch and all
  // "light-mode" decks onto one white swatch).
  return ["#000000", "#FFFFFF"];
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function classify(hex: string): ColorKind {
  const { s, l } = hexToHsl(hex);
  // Lightness gates FIRST — very-dark / very-light colours read as
  // black/white regardless of HSL saturation. The naive
  // "saturation > 0.15 → chromatic" check would let `#020807`
  // (RGB 2/8/7) through as chromatic with s ≈ 0.6 even though it's
  // visually indistinguishable from pure black. Order matters.
  if (l < LIGHT_MIN) return "black";
  if (l > LIGHT_MAX) return "white";
  if (s > SAT_MIN) return "chromatic";
  return "grey";
}

// Standard HSL conversion. Inputs in `#RRGGBB` form. Outputs:
//   h in [0, 360)
//   s, l in [0, 1]
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}
