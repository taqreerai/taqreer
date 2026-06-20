// Single source of truth for fitting a native-sized slide artboard into the
// editor workspace. The Canva-style editor sizes its iframe to the WHOLE
// workspace and floats the artboard inside it, centred + scaled to fit. Two
// places need that exact rect:
//   • SlideEditor — the iframe's internal `#tqe-scene` transform (the scale +
//     centred pan that positions the artboard).
//   • DeckView — the parent-side AI halo + comment overlay, which must sit over
//     the artboard's on-screen rect (not the bigger workspace box).
// Both measure the SAME box (the workspace), so deriving the fit from one shared
// function keeps the iframe's artboard and the overlays pixel-aligned with no drift.

// Breathing room around the artboard at fit (a little dark workspace on every side).
export const FIT_MARGIN = 0.92;

export type ArtboardFit = {
  /** on-screen px per native px */
  scale: number;
  /** artboard on-screen size */
  width: number;
  height: number;
  /** centred offset of the artboard inside the workspace (top-left) */
  offsetX: number;
  offsetY: number;
};

// Fit `nativeW × nativeH` centred inside `viewportW × viewportH`. Returns null
// until the viewport is measured (both > 0) so callers can fall back cleanly.
export function fitArtboard(
  viewportW: number,
  viewportH: number,
  nativeW: number,
  nativeH: number,
): ArtboardFit | null {
  if (!(viewportW > 0 && viewportH > 0 && nativeW > 0 && nativeH > 0)) return null;
  const scale = Math.min(viewportW / nativeW, viewportH / nativeH) * FIT_MARGIN;
  const width = nativeW * scale;
  const height = nativeH * scale;
  return {
    scale,
    width,
    height,
    offsetX: (viewportW - width) / 2,
    offsetY: (viewportH - height) / 2,
  };
}
