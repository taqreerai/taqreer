// Bridges CSS `background-clip: text` + `linear-gradient(...)` to a real
// OOXML gradient fill on the text run. dom-to-pptx + PptxGenJS can only
// emit a solid color on a run, so we use a sentinel-color trick:
//
//   1. Before export, find every gradient-text element in the live DOM.
//   2. Replace its CSS with a unique solid sentinel hex (#FE00xx) and
//      remember the gradient spec in a Map.
//   3. After export, the BiDi post-processor sees the sentinel hex in
//      <a:srgbClr val="FE00xx"/> inside an <a:rPr>'s <a:solidFill> and
//      swaps the solidFill for the real <a:gradFill> built from the spec.
//
// Why sentinel hex rather than data attributes:
//   - dom-to-pptx's run emission only preserves color/font/weight — any
//     custom data-* attribute is lost. Color survives end-to-end.
//   - PASS 2 of bidi-postprocess merges adjacent runs that share an rPr
//     signature. Same sentinel color → same signature → merged into one
//     run, which is exactly what we want (one gradient fill per element).
//   - Reserved range #FE0001..#FEFFFE: 65k slots, well outside any real
//     palette. Claude's design tokens never land here.

export type GradientStop = {
  /** 0..100000, 1000ths of a percent (ST_PositiveFixedPercentage). */
  pos: number;
  /** Uppercase 6-digit hex, no leading '#'. */
  hex: string;
};

export type LinearGradientSpec = {
  kind: "linear";
  /** OOXML ang attribute: 0..21599999 (60000ths of a degree). */
  angle: number;
  stops: GradientStop[];
};

export type RadialGradientSpec = {
  kind: "radial";
  /**
   * Focus rectangle in 1000ths of a percent (OOXML fillToRect). Always
   * collapsed to the center for v1 — i.e. l=t=r=b=50000. Off-center radial
   * focus (`radial-gradient(at top left, ...)`) is not yet mapped; those
   * gradients render as centered.
   */
  stops: GradientStop[];
};

export type GradientSpec = LinearGradientSpec | RadialGradientSpec;

/** Sentinel hex (no '#', uppercase) → gradient recipe. */
export type GradientIntents = Map<string, GradientSpec>;

const SENTINEL_PREFIX = "FE";

/**
 * Convert CSS gradient angle to OOXML `a:lin/@ang` value.
 *
 * CSS:   0deg = "to top"     (gradient direction points up)
 * OOXML: 0    = color change runs left → right (gradient points right)
 *
 * So CSS 0° corresponds to OOXML 270°. General formula:
 *   ooxmlDeg = (cssDeg - 90 + 360) mod 360
 *   ang      = ooxmlDeg * 60000
 *
 * Verified against MS sample `<a:lin ang="16200000"/>` (= 270° OOXML =
 * 0° CSS = "to top") from python-pptx docs and ECMA-376 §20.1.10.44.
 */
export function cssAngleToOoxml(cssDeg: number): number {
  const ooxmlDeg = (((cssDeg - 90) % 360) + 360) % 360;
  return Math.round(ooxmlDeg * 60000);
}

/**
 * Parse any CSS color string to a 6-digit uppercase hex using the
 * browser's own color parser via canvas 2d fillStyle round-trip.
 * Returns null for invalid input. Alpha is dropped (OOXML solidFill +
 * separate <a:alpha/> would be needed for that — out of scope for v1).
 *
 * CSS.supports() is the front gate: canvas fillStyle silently keeps the
 * previous value on invalid input, so a bare keyword like "circle" would
 * otherwise round-trip as whatever default we set (the reason radial
 * gradients picked up a phantom black stop before this gate existed).
 */
function parseColorToHex(input: string): string | null {
  if (!input) return null;
  if (typeof CSS === "undefined" || !CSS.supports("color", input)) return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = input;
  const out = ctx.fillStyle;
  if (typeof out === "string") {
    if (out.startsWith("#") && out.length === 7) {
      return out.slice(1).toUpperCase();
    }
    const m = out.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      return [m[1], m[2], m[3]]
        .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    }
  }
  return null;
}

const ANGLE_KEYWORD: Record<string, number> = {
  "to top": 0,
  "to top right": 45,
  "to right top": 45,
  "to right": 90,
  "to bottom right": 135,
  "to right bottom": 135,
  "to bottom": 180,
  "to bottom left": 225,
  "to left bottom": 225,
  "to left": 270,
  "to top left": 315,
  "to left top": 315,
};

function parseAngleToken(tok: string): number | null {
  const k = tok.toLowerCase().replace(/\s+/g, " ").trim();
  if (k in ANGLE_KEYWORD) return ANGLE_KEYWORD[k];
  const deg = k.match(/^(-?\d*\.?\d+)deg$/);
  if (deg) return parseFloat(deg[1]);
  const turn = k.match(/^(-?\d*\.?\d+)turn$/);
  if (turn) return parseFloat(turn[1]) * 360;
  const rad = k.match(/^(-?\d*\.?\d+)rad$/);
  if (rad) return (parseFloat(rad[1]) * 180) / Math.PI;
  const grad = k.match(/^(-?\d*\.?\d+)grad$/);
  if (grad) return (parseFloat(grad[1]) * 360) / 400;
  return null;
}

/** Split a comma-separated CSS value at top level (skipping commas inside `()`). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Parse comma-separated stop tokens (the part after the angle/position prefix)
 * into normalised GradientStop[]. Missing positions are filled by linear
 * interpolation between defined neighbours, with implicit 0% / 100% anchors.
 *
 * Returns null if any stop has an unparseable color. Color hints (CSS 4
 * mid-position-only entries with no color) are ignored.
 */
function parseStops(stopParts: string[]): GradientStop[] | null {
  if (stopParts.length < 2) return null;

  type RawStop = { hex: string; pos: number | null };
  const raw: RawStop[] = [];
  for (const sp of stopParts) {
    const toks = sp.split(/\s+/);

    // CSS 4 color hint: a single percentage with no color (`red, 50%, blue`).
    // Skip it — gsLst can't represent a hint without a color.
    if (toks.length === 1 && /%$/.test(toks[0])) continue;

    let posTok: string | null = null;
    if (toks.length > 1 && /%$/.test(toks[toks.length - 1])) {
      posTok = toks.pop() as string;
    }
    const hex = parseColorToHex(toks.join(" "));
    if (!hex) return null;
    const pos = posTok ? parseFloat(posTok) * 1000 : null;
    raw.push({ hex, pos });
  }
  if (raw.length < 2) return null;

  if (raw[0].pos === null) raw[0].pos = 0;
  if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 100000;
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i].pos !== null) continue;
    let j = i + 1;
    while (j < raw.length && raw[j].pos === null) j++;
    const prevPos = raw[i - 1].pos as number;
    const nextPos = raw[j].pos as number;
    const slots = j - (i - 1);
    raw[i].pos = prevPos + (nextPos - prevPos) / slots;
  }

  return raw.map((r) => ({
    pos: Math.max(0, Math.min(100000, Math.round(r.pos as number))),
    hex: r.hex,
  }));
}

/**
 * Parse `linear-gradient(...)` or `radial-gradient(...)` into a GradientSpec.
 * Returns null for unsupported forms (`conic-gradient`,
 * `repeating-*-gradient`, malformed input).
 *
 * For `radial-gradient`, the shape/size/position prefix (`circle at top`,
 * `ellipse 100px 50px`, etc.) is ignored — we always emit a centered radial
 * fill. Lossy but predictable; off-center radial focus on text is rare.
 */
export function parseGradient(value: string): GradientSpec | null {
  const trimmed = value.trim();

  // Explicitly reject unsupported gradient functions so callers can fall
  // through to "no gradient detected" rather than crashing.
  if (/^(conic-gradient|repeating-[a-z-]+-gradient)\s*\(/i.test(trimmed)) {
    return null;
  }

  const linearMatch = trimmed.match(/^linear-gradient\(([\s\S]*)\)\s*$/i);
  if (linearMatch) {
    const parts = splitTopLevel(linearMatch[1]);
    if (parts.length < 2) return null;

    let cssDeg = 180;
    let stopParts = parts;
    const maybeAngle = parseAngleToken(parts[0]);
    if (maybeAngle !== null) {
      cssDeg = maybeAngle;
      stopParts = parts.slice(1);
    }
    const stops = parseStops(stopParts);
    if (!stops) return null;
    return { kind: "linear", angle: cssAngleToOoxml(cssDeg), stops };
  }

  const radialMatch = trimmed.match(/^radial-gradient\(([\s\S]*)\)\s*$/i);
  if (radialMatch) {
    const parts = splitTopLevel(radialMatch[1]);
    if (parts.length < 2) return null;

    // First token MAY be a shape/size/position prefix. If parseColorToHex
    // can't read it as a color (and it isn't itself a percentage-only stop
    // hint), treat it as the prefix and drop it. This catches `circle`,
    // `ellipse 100px 50px`, `circle at top left`, etc.
    let stopParts = parts;
    const first = parts[0];
    const firstTokens = first.split(/\s+/);
    const firstAsColor = parseColorToHex(firstTokens[0]);
    if (!firstAsColor && firstTokens[0] !== "" && !/%$/.test(firstTokens[0])) {
      stopParts = parts.slice(1);
    }
    const stops = parseStops(stopParts);
    if (!stops) return null;
    return { kind: "radial", stops };
  }

  return null;
}

/**
 * Pick the first gradient layer from a `background-image` value that may
 * contain multiple layers (e.g. `linear-gradient(...), url(...)`). Layer
 * order in CSS is top-to-bottom in painting; the first layer is what the
 * user sees on top, so it's what we apply to the text.
 */
export function pickFirstGradientLayer(bgImage: string): GradientSpec | null {
  if (!bgImage || bgImage === "none") return null;
  const layers = splitTopLevel(bgImage);
  for (const layer of layers) {
    const spec = parseGradient(layer);
    if (spec) return spec;
  }
  return null;
}

/**
 * Allocates a sentinel hex on each call. Counter starts at 1 so #FE0000 is
 * reserved (some authors actually pick it; we leave it out of the range).
 */
function makeSentinelAllocator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    if (counter > 0xfffe) {
      throw new Error("gradient-text: sentinel range exhausted (65534 slots)");
    }
    const id = counter.toString(16).padStart(4, "0").toUpperCase();
    return `${SENTINEL_PREFIX}${id}`;
  };
}

/**
 * Walk the offscreen DOM, find every element using `background-clip: text`
 * with a `linear-gradient(...)` background, replace its CSS with a solid
 * sentinel color, and return the sentinel→gradient map.
 *
 * Call this AFTER the slide is mounted offscreen at 1920×1080 and BEFORE
 * `exportToPptx`. The mutation is intentional: dom-to-pptx reads
 * `getComputedStyle` on the live DOM, so the override is what it sees.
 */
export function extractGradientIntents(roots: HTMLElement[]): GradientIntents {
  const intents: GradientIntents = new Map();
  const allocSentinel = makeSentinelAllocator();

  for (const root of roots) {
    const all = root.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(all)) {
      const style = getComputedStyle(el);
      const bgClip = style.webkitBackgroundClip || style.backgroundClip;
      if (bgClip !== "text") continue;
      const bgImage = style.backgroundImage;
      if (!bgImage || bgImage === "none") continue;
      // Quick prefilter: skip if no recognised gradient function appears in
      // any layer. Saves walking conic-only or url-only backgrounds.
      if (!/linear-gradient|radial-gradient/i.test(bgImage)) continue;

      const spec = pickFirstGradientLayer(bgImage);
      if (!spec) continue;

      // Each gradient element gets its own sentinel even if the recipe is
      // identical to another. Sharing sentinels caused PASS 2's run-merge to
      // collapse separate gradient elements into one run, stretching a single
      // gradient across both. Per-element sentinels give each element its own
      // rPr signature → no merge → independent gradient per element.
      const sentinel = allocSentinel();
      intents.set(sentinel, spec);

      // Override so dom-to-pptx emits a plain solidFill with our sentinel hex.
      // -webkit-background-clip: text + transparent fill is what makes a real
      // gradient text visible in the browser; we strip the whole mechanism.
      el.style.backgroundImage = "none";
      el.style.webkitBackgroundClip = "initial";
      el.style.backgroundClip = "initial";
      el.style.webkitTextFillColor = "initial";
      el.style.color = `#${sentinel}`;
    }
  }

  return intents;
}
