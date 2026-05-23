// Deterministic per-user gradient picker for fallback avatars.
//
// Users who signed up via Google OAuth get a real avatar via
// `User.image`. Users who signed up with email/password have no image,
// so we render their initial on a coloured gradient instead. The
// gradient is deterministic on the user's stable id so the same user
// always shows the same colour across the app — collaboration UIs
// rely on this for "which avatar is which person" recognition.
//
// We pick from 4 brand-rotation gradients defined in globals.css
// (`--tq-gradient-avatar-{0,1,2,3}`). 4 is enough variety for the
// realistic concurrent-viewer count per deck (2–4); keeping the
// palette small keeps the choices on-brand.

const AVATAR_GRADIENT_COUNT = 4;

/**
 * Hash a string to a uniform integer in [0, max). Deterministic FNV-1a
 * variant — small + collision-resistant enough for a 4-bucket pick.
 */
function hashToBucket(seed: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % max;
}

/**
 * Return the CSS `var(--tq-gradient-avatar-N)` token for a given
 * seed (prefer userId; fall back to name). Empty / missing seed
 * returns the canonical brand gradient (bucket 0) so unknown-user
 * rows still look intentional.
 */
export function avatarGradientForSeed(seed: string | null | undefined): string {
  if (!seed) return "var(--tq-gradient-avatar-0)";
  const bucket = hashToBucket(seed, AVATAR_GRADIENT_COUNT);
  return `var(--tq-gradient-avatar-${bucket})`;
}
