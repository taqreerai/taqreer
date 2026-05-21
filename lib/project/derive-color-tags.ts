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
  "#8B5CF6", // purple  (also catches pink/magenta — hue 255–345)
  "#9CA3AF", // grey    (mid-lightness low-saturation)
  "#000000", // black
  "#FFFFFF", // white
] as const;

// Maps any hex into its canonical bucket. Returns one of the
// COLOR_BUCKETS entries above.
//
// Classification order matters:
//   1. Lightness extremes (very dark / very light) → black/white,
//      regardless of nominal hue. Catches `#020807` (h=170 but
//      visually black).
//   2. Greyscale (sat < 0.15) → grey. Distinct from black/white now
//      that grey is its own bucket per the 10-color taxonomy.
//   3. Brown — dark warm chromatic (hue 15–50°, lightness < 0.45).
//      Catches darkened oranges + dark yellows like #964B00 that
//      read as brown to most users. Dark REDS (hue 0–15°) keep
//      their identity as red, not brown.
//   4. Standard hue buckets for the remaining chromatics. Blue and
//      purple have widened ranges (cyan folds into blue, pink folds
//      into purple) so the user's 10-color list is the exhaustive
//      taxonomy.
export function bucketize(hex: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return "#000000"; // defensive
  const { h, s, l } = hexToHsl(hex.toUpperCase());
  if (l < LIGHT_MIN) return "#000000";
  if (l > LIGHT_MAX) return "#FFFFFF";
  if (s < SAT_MIN) return "#9CA3AF"; // grey
  // Brown — warm hue that's EITHER dark (saturated dark browns
  // like saddle-brown `#8B4513`) OR muted (tans, beiges, creams
  // like `#E3DBCA`). Both are perceived as "earth tone / brown
  // family" by users even though their HSL coordinates differ
  // wildly. Without the saturation gate, a cream `#E3DBCA`
  // (h=41, s=0.31, l=0.84) leaks into orange because it sits
  // above the dark-lightness threshold despite reading as brown
  // visually. With it, bright saturated saffron (`#F4AA0B`, s=0.91)
  // stays in orange — only the muted warms route here.
  if (h >= 15 && h < 50 && (l < 0.45 || s < 0.5)) return "#92400E";
  if (h < 15 || h >= 345) return "#EF4444"; // red (wraps the wheel)
  if (h < 45) return "#F97316"; // orange
  if (h < 75) return "#EAB308"; // yellow
  if (h < 165) return "#22C55E"; // green
  // Blue/purple boundary at 250° — below that, sky blue + royal
  // blue + indigo edge cases. Above that, indigo-violet + violet +
  // lavender + pink-magenta all read as purple to the human eye.
  // Was at 285° initially; a light lavender (`#D4C1E5`, hue 271°)
  // was leaking into blue (user-reported 2026-05-21). 250° puts
  // the canonical Tailwind violet-500 (`#8B5CF6`, hue 258°) firmly
  // in purple, matching its name.
  if (h < 250) return "#3B82F6"; // blue (includes cyan/teal)
  return "#8B5CF6"; // purple (includes pink/magenta/lavender)
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
