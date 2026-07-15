// Normalize an uploaded logo SVG's `viewBox` to the tight bounding box of its
// visible artwork.
//
// Uploaded logos routinely ship with a large empty margin baked into the
// viewBox (a small mark centred in a 1000x1000 box, an Illustrator artboard
// that was never cropped, etc.). Every downstream sizing path fits the WHOLE
// viewBox into the reserved logo box, so that padding shrinks the visible mark
// on every slide:
//   - MONOCHROME path inlines the SVG and sizes it by its own viewBox.
//   - POLYCHROME path injects `<img style="object-fit:contain">`, which scales
//     the whole padded box into the corner.
// Trimming the viewBox to the artwork ONCE, at upload, fixes every consumer
// uniformly (inline SVG, injected <img>, live preview, PPTX/PDF export) because
// they all read the one stored file.
//
// Measurement is done with sharp (already a dependency) rather than Puppeteer:
// rasterize the SVG at a bounded density, trim the transparent border, and map
// the trimmed pixel rect back to viewBox user units. No Chromium launch on the
// user-facing upload route, no setContent/SSRF surface, and the raster trim
// captures true visual ink (strokes included).
//
// BEST-EFFORT: any failure (unparseable box, sharp/librsvg error, uniform image
// with nothing to trim, degenerate result) returns the INPUT string untouched.
// Normalization must never fail an upload.

import sharp from "sharp";

type ViewBox = { x: number; y: number; w: number; h: number };

// Read the SVG's user-coordinate box: prefer `viewBox`, fall back to the root
// `width`/`height` attributes. Everything is read from the ROOT `<svg …>`
// opening tag only, so an inner shape's dims (e.g. a `<rect width="40">`) can
// never be mistaken for the document box. Returns null when nothing yields a
// usable box.
function readViewBox(svg: string): ViewBox | null {
  const rootTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const vb = rootTag.match(/viewBox\s*=\s*["']([\d.\-eE+\s,]+)["']/);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
  }
  // Fall back to the root width/height, but accept ONLY unitless or `px` values.
  // Absolute units (cm/mm/in/pt), font-relative units (em/ex), and percentages
  // don't map 1:1 to the user-unit coordinate the trim math assumes — parsing
  // `10cm` as `10` (parseFloat drops the suffix) would build a bogus box.
  const asUserUnits = (raw: string | undefined): number | null => {
    if (raw === undefined) return null;
    const v = raw.trim();
    if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(v)) return null;
    const n = parseFloat(v);
    return n > 0 ? n : null;
  };
  const w = asUserUnits(rootTag.match(/\bwidth\s*=\s*["']?\s*([^"'\s>]+)/i)?.[1]);
  const h = asUserUnits(
    rootTag.match(/\bheight\s*=\s*["']?\s*([^"'\s>]+)/i)?.[1],
  );
  if (w !== null && h !== null) return { x: 0, y: 0, w, h };
  return null;
}

// Target ~1024px on the long side of the measurement raster. Deriving the
// density from the viewBox (instead of a fixed dpi) keeps the raster bounded:
// a huge viewBox (e.g. 10000 units) would otherwise rasterize to gigapixels and
// OOM the box. Clamped so tiny viewBoxes still render at a usable resolution.
function densityFor(vb: ViewBox): number {
  const longSide = Math.max(vb.w, vb.h);
  const TARGET_PX = 1024;
  const raw = Math.round((72 * TARGET_PX) / longSide);
  return Math.max(24, Math.min(2400, raw));
}

const TRIM_THRESHOLD = 10; // sharp trim tolerance (0-255); tolerate AA fringe
const MIN_MARGIN = 0.9; // only rewrite when content fills <= 90% of a side
const PAD = 0.02; // 2% uniform padding so strokes / round caps aren't clipped
const RASTER_TIMEOUT_MS = 5000; // deadline per sharp render on the upload path

// `densityFor` bounds the raster SIZE, not render TIME — a pathological SVG
// (thousands of nodes, heavy filters) can still keep librsvg busy. Bound each
// render with a deadline so such inputs reject and fail open (store the file
// verbatim) instead of stalling the user-facing upload request.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("raster timeout")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Return `svg` with its root `viewBox` tightened to the artwork's bounding box
 * (fixed root `width`/`height` dropped so it scales to any box), or the input
 * unchanged when there is no meaningful margin to trim or measurement fails.
 */
export async function normalizeLogoViewBox(svg: string): Promise<string> {
  try {
    const vb = readViewBox(svg);
    if (!vb || vb.w <= 0 || vb.h <= 0) return svg;

    const buf = Buffer.from(svg, "utf-8");
    const density = densityFor(vb);

    // Full raster dims (the whole viewBox) — used to map px -> user units.
    const full = await withTimeout(
      sharp(buf, { density }).png().toBuffer({ resolveWithObject: true }),
      RASTER_TIMEOUT_MS,
    );
    const fullW = full.info.width;
    const fullH = full.info.height;
    if (!fullW || !fullH) return svg;

    // Trimmed content rect. Throws on a uniform image (nothing to trim) — a
    // logo that fills its box edge-to-edge, or a solid-background mark; either
    // way there is no margin to remove, so leave it as-is.
    let trim: sharp.OutputInfo;
    try {
      const trimmed = await withTimeout(
        sharp(buf, { density })
          .png()
          .trim({ threshold: TRIM_THRESHOLD })
          .toBuffer({ resolveWithObject: true }),
        RASTER_TIMEOUT_MS,
      );
      trim = trimmed.info;
    } catch {
      return svg;
    }

    const cwPx = trim.width;
    const chPx = trim.height;
    if (!cwPx || !chPx) return svg;

    // Map raster px -> viewBox user units (uniform scale per axis).
    const scaleX = vb.w / fullW;
    const scaleY = vb.h / fullH;
    let nx = vb.x + -(trim.trimOffsetLeft ?? 0) * scaleX;
    let ny = vb.y + -(trim.trimOffsetTop ?? 0) * scaleY;
    let nw = cwPx * scaleX;
    let nh = chPx * scaleY;
    if (!(nw > 0) || !(nh > 0)) return svg;

    // Only rewrite when there is meaningful dead margin. `fill` is the larger
    // of the two content-to-box ratios; a mark already filling >90% of either
    // dimension is left untouched (avoids sub-pixel churn and re-running the
    // one-off migration on already-tight logos).
    const fill = Math.max(nw / vb.w, nh / vb.h);
    if (fill > MIN_MARGIN) return svg;

    // Uniform padding around the trimmed art.
    const padX = nw * PAD;
    const padY = nh * PAD;
    nx -= padX;
    ny -= padY;
    nw += padX * 2;
    nh += padY * 2;

    const round = (n: number) => Math.round(n * 1000) / 1000;
    const newVb = `${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}`;

    // Rewrite the ROOT <svg> opening tag ONLY: drop fixed width/height (so the
    // mark scales to any box) and set the tight viewBox. Scoping every mutation
    // to the root tag avoids a whole-document replace clobbering an INNER
    // element's viewBox (nested <svg>/<symbol>/<pattern>) when the root itself
    // carries width/height instead of a viewBox — which would leave the root
    // with no sizing box at all.
    return svg.replace(/<svg\b[^>]*>/i, (tag) => {
      let t = tag.replace(
        /\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi,
        "",
      );
      t = /viewBox\s*=\s*["'][^"']*["']/i.test(t)
        ? t.replace(/viewBox\s*=\s*["'][^"']*["']/i, `viewBox="${newVb}"`)
        : t.replace(/<svg\b/i, `<svg viewBox="${newVb}"`);
      return t;
    });
  } catch {
    return svg;
  }
}
