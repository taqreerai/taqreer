// Deterministic per-user gradient picker for fallback avatars.
//
// Users who signed up via Google OAuth get a real avatar via
// `User.image`. Users who signed up with email/password have no image,
// so we render their initial on a coloured gradient instead. The
// gradient is deterministic on the user's stable id so the same user
// always shows the same colour across the app — collaboration UIs
// rely on this for "which avatar is which person" recognition.
//
// Color model: OKLCH, NOT HSL or brand-palette buckets.
//
// Why OKLCH:
//   • Full 360° hue range → effectively unlimited unique gradients
//     (collision risk on a single project goes from 1/4 with the
//     old brand-bucket approach to ≈ 1/360 — practically zero).
//   • Perceptually uniform lightness — `L = 45 %` reads as the same
//     visual darkness for red, yellow, green, blue, purple. HSL's
//     `L = 45 %` for yellow is much brighter than HSL `L = 45 %` for
//     blue, which would make white text unreadable on the yellow
//     end of the palette.
//   • Chroma 0.15 stays in-gamut for sRGB displays across every
//     hue. Higher chroma (0.20+) clips for green/yellow and the
//     browser falls back to a less-saturated approximation.
//
// Why not pure random with `Math.random()`:
//   • Avatars need to be STABLE across renders, sessions, and tabs.
//     Two viewers should see the SAME colour for the SAME person.
//   • A deterministic hash from the seed (prisma user id) gives us
//     this for free.
//
// Contrast target: WCAG 4.5:1 white-on-background, achieved by
// keeping the gradient's L in [42 %, 52 %]. The initial sits at the
// gradient's visual centre (~ L 47 %), well within contrast budget.

// Default for `seed == null` (anonymous public-view, legacy rows
// without an author id, etc.). Canonical brand blue → magenta so
// unknown-user rows stay on-brand instead of getting a random hue.
const DEFAULT_GRADIENT =
  "linear-gradient(135deg, #370BF4 0%, #E036B8 100%)";

/**
 * Hash a string to a uniform unsigned 32-bit integer. Deterministic
 * FNV-1a variant — small + collision-resistant enough for the 360
 * hue buckets we map onto. Pure JS, no Web Crypto dependency so it
 * works in SSR + every browser context.
 */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Return a CSS `linear-gradient(...)` string for the given seed
 * (prefer userId; fall back to email / name). Empty / missing seed
 * returns the canonical brand gradient so unknown-user rows still
 * look intentional.
 */
export function avatarGradientForSeed(seed: string | null | undefined): string {
  if (!seed) return DEFAULT_GRADIENT;
  const h = hashSeed(seed);
  // Primary hue spans the full 360° wheel via hash modulo. Second
  // stop hue shifts 45° away — far enough for visual variety, close
  // enough that the gradient reads as ONE colour with depth (not
  // two unrelated colours). 45° vs 60°: 45 picked after eyeballing
  // sample palettes — 60 felt like an unintentional "complementary
  // colour pair" at some hues.
  const hue1 = h % 360;
  const hue2 = (hue1 + 45) % 360;
  // OKLCH L = 42 % / 52 % keeps the gradient dark enough for white
  // text at every hue (perceptual uniformity guarantee). Slight
  // lightness ramp + slight chroma bump on the second stop creates
  // subtle visual depth without making the brighter stop fail
  // contrast.
  return (
    `linear-gradient(135deg, ` +
    `oklch(42% 0.15 ${hue1}) 0%, ` +
    `oklch(52% 0.17 ${hue2}) 100%)`
  );
}
