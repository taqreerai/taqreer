// Free-plan branding (2026-10-02): the "Made with taqreer.ai" watermark on
// every slide + a system-appended branded closing slide. One definition shared
// by the studio (components/preview/FreeBranding.tsx), the server PNG export
// (html-document-server) and the in-browser PPTX export (free-branding-canvas),
// so all three draw the same thing.
//
// Neither element is ever stored in slideJson: they are rendered on top of /
// after the user's slides at view and export time, gated on the deck OWNER's
// plan (load-project `brandingWatermark`), so they can't be edited in the
// studio and they disappear by themselves the moment the owner upgrades.

import {
  BARS_PATH,
  BARS_VIEWBOX,
  WORDMARK_PATHS,
  WORDMARK_RECTS,
  WORDMARK_VIEWBOX,
} from "@/lib/export/brand-marks";

export const WATERMARK_TEXT = "Made with";
export const WATERMARK_BRAND = "taqreer.ai";
export const SITE_LABEL = "taqreer.ai";

/** Closing-slide slogan in the deck's language (owner pick 2026-10-02). */
export const CLOSING_SLOGAN = {
  ar: "عروض تقديمية تتحدث العربية",
  en: "Presentations that speak Arabic",
} as const;

// /ar/brand: one flat dark surface, one blue accent.
export const BRAND = {
  surface: "#0A0A0A",
  accent: "#0057FF",
  accentLight: "#3380FF",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.72)",
} as const;

export const CAIRO_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap";

export type BrandLang = "ar" | "en";
export type SlideDims = { width: number; height: number };

/**
 * The watermark sits in the bottom corner where the eye lands last on each
 * slide (the reading "terminal" area): bottom-LEFT for right-to-left Arabic
 * decks, bottom-RIGHT for English ones.
 */
export function watermarkSide(lang: BrandLang): "left" | "right" {
  return lang === "en" ? "right" : "left";
}

/** Badge geometry in slide pixels, proportional to the slide's short side. */
export function watermarkGeometry(dims: SlideDims) {
  const unit = Math.min(dims.width, dims.height);
  const height = Math.round(unit * 0.064);
  return {
    height,
    margin: Math.round(unit * 0.034),
    padX: Math.round(height * 0.42),
    icon: Math.round(height * 0.68),
    gap: Math.round(height * 0.26),
    fontSize: Math.round(height * 0.38),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The bars mark on a blue rounded square, as inline SVG. */
export function barsIconSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${BARS_VIEWBOX} ${BARS_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="${BARS_VIEWBOX}" height="${BARS_VIEWBOX}" rx="13.14" fill="${BRAND.accent}"/><path d="${BARS_PATH}" fill="#FFFFFF"/></svg>`;
}

/** The white "taqreer" wordmark, as inline SVG at a given width. */
export function wordmarkSvg(width: number, fill: string = BRAND.text): string {
  const height = (width * WORDMARK_VIEWBOX.h) / WORDMARK_VIEWBOX.w;
  const paths = WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join("");
  const rects = WORDMARK_RECTS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
  return `<svg width="${width}" height="${height.toFixed(1)}" viewBox="0 0 ${WORDMARK_VIEWBOX.w} ${WORDMARK_VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg" fill="${fill}" aria-hidden="true">${paths}${rects}</svg>`;
}

/**
 * The watermark badge as an absolutely positioned element inside a slide box
 * of `dims`. `data-tq-badge` marks it so the studio can make only the badge
 * clickable (upsell) on an otherwise pointer-events:none layer.
 */
export function watermarkHtml(
  lang: BrandLang,
  dims: SlideDims,
  opts: { cover?: boolean } = {},
): string {
  // The cover (slide 1) carries a larger badge with the slogan (2026-10-02):
  // the one slide nobody deletes, so the brand message survives even when the
  // closing slide is removed from a downloaded deck.
  const base = watermarkGeometry(dims);
  const k = opts.cover ? 1.3 : 1;
  const g = {
    height: Math.round(base.height * k),
    margin: base.margin,
    padX: Math.round(base.padX * k),
    icon: Math.round(base.icon * k),
    gap: Math.round(base.gap * k),
    fontSize: Math.round(base.fontSize * k),
  };
  const side = watermarkSide(lang);
  const slogan = opts.cover
    ? `<span style="opacity:0.45;font-weight:400">·</span><span dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-weight:600;opacity:0.9">${esc(CLOSING_SLOGAN[lang])}</span>`
    : "";
  return `<div data-tq-badge dir="ltr" style="position:absolute;${side}:${g.margin}px;bottom:${g.margin}px;height:${g.height}px;display:flex;align-items:center;gap:${g.gap}px;padding:0 ${g.padX}px 0 ${Math.round(g.padX * 0.55)}px;border-radius:${g.height}px;background:rgba(10,10,10,0.9);border:${Math.max(1, Math.round(g.height * 0.03))}px solid rgba(255,255,255,0.22);box-shadow:0 ${Math.round(g.height * 0.12)}px ${Math.round(g.height * 0.45)}px rgba(0,0,0,0.35);font-family:'Cairo',sans-serif;font-size:${g.fontSize}px;line-height:1;white-space:nowrap;color:${BRAND.text};z-index:2147483646">${barsIconSvg(g.icon)}<span style="font-weight:600;opacity:0.85">${esc(WATERMARK_TEXT)}</span><span style="font-weight:800;margin-inline-start:-${Math.round(g.gap * 0.6)}px">${esc(WATERMARK_BRAND)}</span>${slogan}</div>`;
}

/** Closing-slide geometry in slide pixels. */
export function closingGeometry(dims: SlideDims) {
  const unit = Math.min(dims.width, dims.height);
  const portrait = dims.height > dims.width;
  return {
    wordmarkWidth: Math.round(dims.width * (portrait ? 0.72 : 0.44)),
    sloganSize: Math.round(unit * 0.058),
    gap: Math.round(unit * 0.05),
    pillSize: Math.round(unit * 0.03),
  };
}

/** The full branded closing slide, sized to `dims`. */
export function closingSlideHtml(lang: BrandLang, dims: SlideDims): string {
  const g = closingGeometry(dims);
  const slogan = CLOSING_SLOGAN[lang];
  return `<div style="position:relative;width:${dims.width}px;height:${dims.height}px;overflow:hidden;background:${BRAND.surface};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${g.gap}px;font-family:'Cairo',sans-serif;color:${BRAND.text}"><div style="position:absolute;left:50%;bottom:-${Math.round(dims.height * 0.55)}px;width:${Math.round(dims.width * 1.2)}px;height:${Math.round(dims.height)}px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(0,87,255,0.55),rgba(0,87,255,0) 100%)"></div><div style="position:relative">${wordmarkSvg(g.wordmarkWidth)}</div><div dir="${lang === "ar" ? "rtl" : "ltr"}" style="position:relative;font-size:${g.sloganSize}px;font-weight:700;line-height:1.3;text-align:center;padding:0 ${Math.round(dims.width * 0.06)}px">${esc(slogan)}</div><div dir="ltr" style="position:relative;font-size:${g.pillSize}px;font-weight:700;line-height:1;padding:${Math.round(g.pillSize * 0.55)}px ${Math.round(g.pillSize * 1.1)}px;border-radius:${g.pillSize * 2}px;background:${BRAND.accent};color:#FFFFFF">${esc(SITE_LABEL)}</div></div>`;
}
