// Free-plan branding (2026-10-02; reworked 2026-10-04, owner direction): a
// barely visible "Designed with taqreer" mark on every slide EXCEPT the cover,
// and no branded closing slide (BRANDED_CLOSING_SLIDE = false). No ".ai" and
// no "Made with" inside the deck: users who wrote their own content must not
// look like they handed in AI-written work. The closing-slide helpers below
// stay so the slide can be switched back on with the flag. One definition shared
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

export const WATERMARK_TEXT = "Designed with";
export const WATERMARK_BRAND = "taqreer";
/** The appended branded closing slide (studio, PNG + PPTX export). Off since
 *  2026-10-04: users deleted it or skipped exporting because of it. */
export const BRANDED_CLOSING_SLIDE = false;
/** Watermark opacity: present but barely visible (owner, 2026-10-04). */
export const WATERMARK_OPACITY = 0.38;
export const SITE_LABEL = "taqreer.ai";

/** Closing-slide + cover-badge slogan in the deck's language (owner picks
 *  2026-10-02: English decks get their own line, mirroring the Arabic
 *  tagline "من الفكرة إلى عرض جاهز"). */
export const CLOSING_SLOGAN = {
  ar: "عروض تقديمية تتحدث العربية",
  en: "From idea to deck in minutes",
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
  // No mark on the cover (2026-10-04): the slide people care most about.
  if (opts.cover) return "";
  // Smaller than the 2026-10-02 badge (x0.8), no drop shadow, and the whole
  // badge at WATERMARK_OPACITY: readable up close, invisible from the back
  // of a classroom. The soft dark pill keeps it legible on light AND dark
  // slides alike.
  const base = watermarkGeometry(dims);
  const k = 0.8;
  const g = {
    height: Math.round(base.height * k),
    margin: base.margin,
    padX: Math.round(base.padX * k),
    icon: Math.round(base.icon * k),
    gap: Math.round(base.gap * k),
    fontSize: Math.round(base.fontSize * k),
  };
  const side = watermarkSide(lang);
  return `<div data-tq-badge dir="ltr" style="position:absolute;${side}:${g.margin}px;bottom:${g.margin}px;height:${g.height}px;display:flex;align-items:center;gap:${g.gap}px;padding:0 ${g.padX}px 0 ${Math.round(g.padX * 0.55)}px;border-radius:${g.height}px;background:rgba(10,10,10,0.6);opacity:${WATERMARK_OPACITY};font-family:'Cairo',sans-serif;font-size:${g.fontSize}px;line-height:1;white-space:nowrap;color:${BRAND.text};z-index:2147483646">${barsIconSvg(g.icon)}<span style="font-weight:600">${esc(WATERMARK_TEXT)}</span><span style="font-weight:800;margin-inline-start:-${Math.round(g.gap * 0.6)}px">${esc(WATERMARK_BRAND)}</span></div>`;
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
