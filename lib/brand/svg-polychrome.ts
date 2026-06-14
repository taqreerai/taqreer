// Polychrome detection for SVG logos — the single signal behind "can this
// logo be recoloured?". Monochrome (0-1 real colours: a wordmark / icon) is
// safe to flatten or tint for contrast; polychrome (a flag, a full-colour
// mark, an embedded raster, a multi-stop gradient) must keep its own colours
// and is never recoloured. Pure + client-safe (string in, boolean out) so the
// upload preview, the brief assembly, and the deck generator all agree.

// Minimal named-colour folding so "white"/"#fff"/"#ffffff" count as ONE colour
// (otherwise a plain mono logo written two ways reads as false-polychrome and
// stops getting its contrast flatten). Only the colours that actually recur in
// logos need folding; anything else is compared as its lowercased token.
const NAMED_TO_HEX: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  lime: "#00ff00",
  green: "#008000",
  blue: "#0000ff",
};

// Tokens that are NOT a concrete colour (so they never count toward the tally).
const NON_COLOUR = new Set([
  "none",
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "context-fill",
  "context-stroke",
  "url", // a paint-server ref like url(#grad) — its <stop>s are counted instead
]);

function normalizeColour(raw: string): string {
  const c = raw.trim().toLowerCase();
  if (NAMED_TO_HEX[c]) return NAMED_TO_HEX[c];
  // rgb()/rgba() → hex so `rgb(255,255,255)` === `#ffffff` and a mono logo
  // written in mixed syntaxes isn't miscounted as polychrome. Comma- OR
  // space-separated, 0-255 or %; alpha ignored (it's not a distinct hue).
  const rgb = /^rgba?\(([^)]*)\)$/.exec(c);
  if (rgb) {
    const parts = rgb[1].split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 3) {
      const toByte = (v: string) =>
        Math.max(
          0,
          Math.min(
            255,
            Math.round(
              (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v)) ||
                0,
            ),
          ),
        )
          .toString(16)
          .padStart(2, "0");
      return `#${toByte(parts[0])}${toByte(parts[1])}${toByte(parts[2])}`;
    }
  }
  // Expand #rgb / #rgba shorthand to the long form so #fff === #ffffff.
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]?)$/.exec(c);
  if (short) {
    const [, r, g, b, a] = short;
    return `#${r}${r}${g}${g}${b}${b}${a ? a + a : ""}`;
  }
  return c.replace(/\s+/g, "");
}

export function isPolychromeSvg(svg: string): boolean {
  if (typeof svg !== "string" || !svg.includes("<svg")) return false;
  // An embedded raster bitmap (a photo / PNG baked into the SVG) is, by
  // definition, full-colour — treat as polychrome without scanning fills.
  if (/<image\b/i.test(svg)) return true;

  const colours = new Set<string>();
  // fill / stroke / stop-color from BOTH attributes (`fill="…"`) and inline
  // styles (`style="fill:…"`). Hex, rgb(a), hsl(a), or a colour keyword.
  const re =
    /(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z][a-z-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const token = m[1].toLowerCase();
    if (NON_COLOUR.has(token)) continue;
    colours.add(normalizeColour(token));
    if (colours.size >= 2) return true;
  }
  return colours.size >= 2;
}
