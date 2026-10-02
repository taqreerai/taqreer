// Deterministic deck recolor (2026-10-02): re-skins a finished deck with a new
// palette WITHOUT an AI call (instant, free, no credits).
//
// Two layers carry a deck's colour:
//   1. theme.palette → the --brand-N / --primary / --secondary / --accent CSS
//      vars most slide CSS references. Swapping the palette re-skins these.
//   2. Colour LITERALS Claude also writes into the slide HTML: palette hexes
//      pasted verbatim, plus derived tints / shades of them (a lighter card
//      fill, a darker hover). Every #hex / rgb() / rgba() literal is mapped
//      through `mapColor`: an exact palette hit becomes its new colour; a
//      derived shade keeps its offset (hue, saturation ratio, lightness delta)
//      from the palette colour it was derived from, re-anchored on the new one.
//      Neutrals (white, black, greys, shadow rgba) and unrelated hues (a red
//      "negative" marker) are left alone.
//
// Pure string-in / string-out on colour tokens only: the output can never
// gain markup, so it needs no re-sanitising. Photos are untouched.

import type { SlideManifest } from "@/lib/schema/slide";

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function parseHex(hex: string): Rgb | null {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  else if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: f(hh + 1 / 3) * 255, g: f(hh) * 255, b: f(hh - 1 / 3) * 255 };
}

// CIE76 distance in Lab: good enough to tell "same colour" from "a shade of
// it" from "unrelated".
function toLab({ r, g, b }: Rgb) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * fx(y) - 16, a: 500 * (fx(x) - fx(y)), b: 200 * (fx(y) - fx(z)) };
}

function deltaE(a: Rgb, b: Rgb): number {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Near-black / near-white count as neutral too: shadow rgba(10,12,16,.4)
// must not latch onto a very dark palette ink and get recoloured.
const isNeutral = (c: Hsl) => c.s < 0.12 || c.l < 0.1 || c.l > 0.95;
// Anchors (the palette colours) use a looser cut: a near-white cream like
// #FBF6EC is still a real surface colour whose tints should follow it.
const isNeutralAnchor = (c: Hsl) => c.s < 0.12 || c.l < 0.04 || c.l > 0.985;

type Role = "light" | "dark" | "chromatic";

function roleOf(hex: string): Role {
  const rgb = parseHex(hex);
  if (!rgb) return "chromatic";
  const { s, l } = rgbToHsl(rgb);
  if (l >= 0.85) return "light";
  if (l <= 0.18 || (s < 0.12 && l < 0.35)) return "dark";
  return "chromatic";
}

function nudge(hex: string, dl: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const c = rgbToHsl(rgb);
  return toHex(hslToRgb({ ...c, l: clamp01(c.l + dl) }));
}

/**
 * Per-index target palette for a preset: each CURRENT palette entry is mapped
 * by role (light surface → the preset's light, dark ink → its dark), so a
 * light background stays light and dark text stays dark. Accents go to the
 * preset's primary / secondary / accent by PERCEIVED LIGHTNESS first and order
 * second: a bright accent the deck sets on dark slides takes the preset's
 * bright colour (gold, not navy), so it stays readable. Repeats of a role get
 * a small lightness nudge so two distinct deck colours never collapse.
 */
export function presetToPalette(
  current: readonly string[],
  preset: readonly [string, string, string, string, string],
): string[] {
  const lightness = (hex: string) => {
    const rgb = parseHex(hex);
    return rgb ? toLab(rgb).L / 100 : 0.5;
  };
  const accents = [0, 1, 2].map((i) => ({ i, hex: preset[i], L: lightness(preset[i]) }));
  const used = new Set<number>();
  let chroma = 0;
  let lights = 0;
  let darks = 0;
  return current.map((hex) => {
    switch (roleOf(hex)) {
      case "light":
        return lights++ === 0 ? preset[3] : nudge(preset[3], -0.05 * (lights - 1));
      case "dark":
        return darks++ === 0 ? preset[4] : nudge(preset[4], 0.07 * (darks - 1));
      default: {
        const k = chroma++;
        const L = lightness(hex);
        const pool = accents.filter((a) => !used.has(a.i));
        const candidates = pool.length > 0 ? pool : accents;
        let best = candidates[0];
        let bestCost = Infinity;
        for (const a of candidates) {
          const cost = Math.abs(a.L - L) * 2 + Math.abs(a.i - k) * 0.15;
          if (cost < bestCost) {
            bestCost = cost;
            best = a;
          }
        }
        if (pool.length === 0) return nudge(best.hex, 0.12);
        used.add(best.i);
        return best.hex;
      }
    }
  });
}

type Anchor = { from: Rgb; fromHsl: Hsl; to: Rgb; toHsl: Hsl };

function buildAnchors(from: readonly string[], to: readonly string[]): Anchor[] {
  const out: Anchor[] = [];
  from.forEach((hex, i) => {
    const f = parseHex(hex);
    const t = parseHex(to[i] ?? "");
    if (f && t) out.push({ from: f, fromHsl: rgbToHsl(f), to: t, toHsl: rgbToHsl(t) });
  });
  return out;
}

/** Maps one colour through the anchors; null = leave it unchanged. */
function mapRgb(c: Rgb, anchors: Anchor[]): Rgb | null {
  if (anchors.length === 0) return null;
  // Exact (or visually identical) palette hit → the new colour itself.
  let best: Anchor | null = null;
  let bestD = Infinity;
  for (const a of anchors) {
    const d = deltaE(c, a.from);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (best && bestD < 2.5) return best.to;

  const hsl = rgbToHsl(c);
  if (isNeutral(hsl)) return null;

  // A derived shade: nearest chromatic anchor of a similar hue.
  let shadeOf: Anchor | null = null;
  let shadeD = Infinity;
  for (const a of anchors) {
    if (isNeutralAnchor(a.fromHsl)) continue;
    if (hueGap(hsl.h, a.fromHsl.h) > 25) continue;
    const d = deltaE(c, a.from);
    if (d < shadeD) {
      shadeD = d;
      shadeOf = a;
    }
  }
  if (!shadeOf || shadeD > 45) return null;
  const { fromHsl, toHsl } = shadeOf;
  const sRatio = fromHsl.s > 0 ? hsl.s / fromHsl.s : 1;
  return hslToRgb({
    h: toHsl.h + (hsl.h - fromHsl.h),
    s: clamp01(toHsl.s * sRatio),
    l: clamp01(toHsl.l + (hsl.l - fromHsl.l)),
  });
}

// #rgb / #rgba / #rrggbb / #rrggbbaa, not part of a longer word, not an HTML
// entity (&#160;), not an SVG fragment ref (url(#id)) or link (href="#id").
const HEX_RE = /(?<![&\w])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const RGB_RE =
  /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/gi;

// Recorded per deck in theme.baseColors: { current colour → the ORIGINAL
// colour it was recoloured from } (6-digit hex both sides). Every recolor
// looks the original up first and recolours THAT from the original palette,
// so presets never stack on each other and "original colours" is exact.
const MAX_BASE_COLORS = 500;

type Recolorer = {
  convert: (c: Rgb) => Rgb;
  map: Record<string, string>;
};

// Every colour literal in a text, as 6-digit hex keys (same matching rules as
// recolorWith).
function collectKeys(text: string, into: Set<string>) {
  for (const m of text.matchAll(HEX_RE)) {
    const before = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
    if (before.endsWith("url(") || before.endsWith('href="') || before.endsWith("href='")) continue;
    const rgb = parseHex(m[1]);
    if (rgb) into.add(toHex(rgb));
  }
  for (const m of text.matchAll(RGB_RE)) {
    into.add(toHex({ r: +m[1], g: +m[2], b: +m[3] }));
  }
}

/**
 * Precomputes the colour table for one recolor over a known set of literal
 * keys. Two DIFFERENT original colours must never land on the same output
 * (e.g. a cream tint becoming pure white next to a real white), or the way
 * back would be ambiguous: a colliding output is nudged one invisible RGB
 * step until unique. Processed in sorted order so the result is the same no
 * matter which preset the deck is currently wearing.
 */
function makeRecolorer(
  basePalette: readonly string[],
  target: readonly string[],
  prevMap: Readonly<Record<string, string>>,
  keys: Iterable<string>,
): Recolorer {
  const anchors = buildAnchors(basePalette, target);
  const identity = basePalette.every((c, i) => c.toLowerCase() === (target[i] ?? "").toLowerCase());
  const origOf = (key: string) => prevMap[key] ?? key;
  const outFor = new Map<string, string>(); // origKey -> outKey
  const claimed = new Map<string, string>(); // outKey -> origKey
  const origs = [...new Set([...keys].map(origOf))].sort();
  const computed = origs.map((origKey) => {
    const orig = parseHex(origKey)!;
    const out = identity ? orig : (mapRgb(orig, anchors) ?? orig);
    return { origKey, outKey: toHex(out) };
  });
  // Unchanged colours claim their own value first.
  for (const { origKey, outKey } of computed) {
    if (outKey === origKey) {
      claimed.set(outKey, origKey);
      outFor.set(origKey, outKey);
    }
  }
  const map: Record<string, string> = {};
  let size = 0;
  for (const { origKey, outKey } of computed) {
    if (outFor.has(origKey)) continue;
    let key = outKey;
    const owner = claimed.get(key);
    if (owner !== undefined && owner !== origKey) {
      const rgb = parseHex(outKey)!;
      for (let step = 1; step < 64; step++) {
        const delta = step % 2 ? (step + 1) / 2 : -step / 2;
        const b = rgb.b + delta;
        if (b < 0 || b > 255) continue;
        const candidate = toHex({ ...rgb, b });
        if (!claimed.has(candidate)) {
          key = candidate;
          break;
        }
      }
    }
    claimed.set(key, origKey);
    outFor.set(origKey, key);
    if (size < MAX_BASE_COLORS) {
      map[key] = origKey;
      size += 1;
    }
  }
  const convert = (c: Rgb): Rgb => {
    const origKey = origOf(toHex(c));
    const out = outFor.get(origKey);
    if (out) return parseHex(out)!;
    // Not pre-scanned (shouldn't happen): compute directly.
    const orig = parseHex(origKey) ?? c;
    return identity ? orig : (mapRgb(orig, anchors) ?? orig);
  };
  return { convert, map };
}

/** Rewrites every colour literal in a string (slide HTML / CSS). */
function recolorWith(text: string, convert: (c: Rgb) => Rgb): string {
  return text
    .replace(HEX_RE, (match, hex: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 6), offset).toLowerCase();
      if (before.endsWith("url(") || before.endsWith('href="') || before.endsWith("href='")) {
        return match;
      }
      const rgb = parseHex(hex);
      if (!rgb) return match;
      const next = convert(rgb);
      if (toHex(next) === toHex(rgb)) return match;
      let out = toHex(next);
      // Keep the alpha of an 8 / 4-digit hex.
      if (hex.length === 8) out += hex.slice(6).toUpperCase();
      if (hex.length === 4) out += (hex[3] + hex[3]).toUpperCase();
      return hex === hex.toLowerCase() ? out.toLowerCase() : out;
    })
    .replace(RGB_RE, (match, r: string, g: string, b: string, alpha: string | undefined) => {
      const rgb = { r: +r, g: +g, b: +b };
      const next = convert(rgb);
      if (toHex(next) === toHex(rgb)) return match;
      const rr = Math.round(next.r);
      const gg = Math.round(next.g);
      const bb = Math.round(next.b);
      return alpha !== undefined ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
    });
}

/** One-off literal rewrite from one palette to another (tests / tooling). */
export function recolorText(text: string, from: readonly string[], to: readonly string[]): string {
  const keys = new Set<string>();
  collectKeys(text, keys);
  return recolorWith(text, makeRecolorer(from, to, {}, keys).convert);
}

/**
 * Recolors a whole manifest. `targetPalette` is index-aligned with the deck's
 * ORIGINAL palette (theme.basePalette, recorded on the first recolor; the
 * current palette before that): presetToPalette(basePalette, preset.colors),
 * or basePalette itself to restore the original colours.
 */
export function recolorManifest(manifest: SlideManifest, targetPalette: readonly string[]): SlideManifest {
  const { theme } = manifest;
  const base = theme.basePalette ?? theme.palette;
  const to = base.map((c, i) => targetPalette[i] ?? c);
  const keys = new Set<string>();
  for (const sl of manifest.slides) collectKeys(sl.html, keys);
  for (const h of [theme.background, theme.text]) {
    const rgb = parseHex(h);
    if (rgb) keys.add(toHex(rgb));
  }
  const { convert, map } = makeRecolorer(base, to, theme.baseColors ?? {}, keys);
  const hex = (h: string) => {
    const rgb = parseHex(h);
    return rgb ? toHex(convert(rgb)) : h;
  };
  const background = hex(theme.background);
  const text = hex(theme.text);
  const slides = manifest.slides.map((s) => ({ ...s, html: recolorWith(s.html, convert) }));
  return {
    ...manifest,
    theme: {
      ...theme,
      palette: to,
      basePalette: [...base],
      baseColors: map,
      background,
      text,
    },
    slides,
  };
}
