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

/** Which slide corner the badge sits in. */
export type BadgeCorner = { h: "left" | "right"; v: "top" | "bottom" };

/** The default corner: bottom, on the language's reading-end side. */
export function defaultBadgeCorner(lang: BrandLang): BadgeCorner {
  return { h: watermarkSide(lang), v: "bottom" };
}

/**
 * The badge's footprint as fractions of the slide (conservative: the PPTX
 * picture's width, a little wider than the drawn pill) plus its margin.
 */
export function watermarkBox(dims: SlideDims) {
  const base = watermarkGeometry(dims);
  const h = Math.round(base.height * 0.8);
  const w = Math.round(h * 5.8);
  return {
    w: w / dims.width,
    h: h / dims.height,
    mx: base.margin / dims.width,
    my: base.margin / dims.height,
  };
}

/**
 * Collision-aware corner (2026-10-06, owner direction: the badge covered a
 * slide's own footer). Measures where the slide's visible text and pictures
 * actually are and returns the first free corner in this order: the default
 * bottom corner, the other bottom corner, then the two top corners; when all
 * four are busy, the least covered one. Large background pictures (over half
 * the slide) don't count, the badge may sit on those.
 *
 * SELF-CONTAINED on purpose (no imports, no outer references, plain loops):
 * the server PDF / PNG exports run it inside headless Chrome from its source
 * text (freeBadgePlacementScript). `slide` may live in another document (the
 * studio editor iframe); everything is measured in its own viewport.
 */
export function pickBadgeCorner(
  slide: Element,
  box: { w: number; h: number; mx: number; my: number },
  preferred: "left" | "right",
): BadgeCorner {
  const other: "left" | "right" = preferred === "left" ? "right" : "left";
  const fallback: BadgeCorner = { h: preferred, v: "bottom" };
  const sr = slide.getBoundingClientRect();
  if (!sr.width || !sr.height) return fallback;
  const doc = slide.ownerDocument;
  const win = doc.defaultView;
  if (!win) return fallback;
  const rects: number[][] = [];
  const add = (r: DOMRect | DOMRectReadOnly, isPicture: boolean) => {
    if (r.width < 1 || r.height < 1) return;
    const w = r.width / sr.width;
    const h = r.height / sr.height;
    if (isPicture && w * h > 0.5) return;
    rects.push([(r.left - sr.left) / sr.width, (r.top - sr.top) / sr.height, w, h]);
  };
  const visit = (el: Element) => {
    if (el.hasAttribute("data-tq-badge") || el.hasAttribute("data-tq-watermark")) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "svg" || tag === "canvas" || tag === "video" || tag === "picture") {
      add(el.getBoundingClientRect(), true);
      return;
    }
    // Small painted shapes holding text (page-number circles, pills, stamps,
    // tags) occupy their whole box, not just the glyphs: measuring only the
    // text let the badge land on a page-number circle (prod deck 2026-10-12,
    // project cmv5fo3k60004et6du5wbedco, slide 5). Big painted boxes (cards,
    // panels) stay uncounted: the badge may sit on those as before.
    if (el !== slide && (el.textContent || "").trim()) {
      const sbg = cs.backgroundColor;
      const painted =
        (!!sbg && sbg !== "rgba(0, 0, 0, 0)" && sbg !== "transparent") ||
        (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0);
      if (painted) {
        const pr = el.getBoundingClientRect();
        if (pr.width >= 1 && pr.height >= 1 && (pr.width / sr.width) * (pr.height / sr.height) <= 0.02) {
          add(pr, false);
        }
      }
    }
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) {
        if ((n.textContent || "").trim()) {
          const range = doc.createRange();
          range.selectNodeContents(n);
          const list = range.getClientRects();
          for (let j = 0; j < list.length; j++) add(list[j], false);
        }
      } else if (n.nodeType === 1) {
        visit(n as Element);
      }
    }
  };
  visit(slide);
  const candidates: BadgeCorner[] = [
    { h: preferred, v: "bottom" },
    { h: other, v: "bottom" },
    { h: preferred, v: "top" },
    { h: other, v: "top" },
  ];
  // A little breathing room around the badge counts as covered too.
  const padX = box.mx * 0.5;
  const padY = box.my * 0.5;
  let best = fallback;
  let bestArea = Infinity;
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c];
    const x0 = (cand.h === "left" ? box.mx : 1 - box.mx - box.w) - padX;
    const y0 = (cand.v === "top" ? box.my : 1 - box.my - box.h) - padY;
    const x1 = x0 + box.w + padX * 2;
    const y1 = y0 + box.h + padY * 2;
    let area = 0;
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      const ix = Math.min(x1, r[0] + r[2]) - Math.max(x0, r[0]);
      const iy = Math.min(y1, r[1] + r[3]) - Math.max(y0, r[1]);
      if (ix > 0 && iy > 0) area += ix * iy;
    }
    if (area === 0) return cand;
    if (area < bestArea) {
      bestArea = area;
      best = cand;
    }
  }
  return best;
}

/**
 * Script for the server PDF / PNG exports (run with page.evaluate after the
 * fonts settle): moves every slide's badge to its free corner.
 */
export function freeBadgePlacementScript(lang: BrandLang, dims: SlideDims): string {
  const box = JSON.stringify(watermarkBox(dims));
  const side = JSON.stringify(watermarkSide(lang));
  const m = watermarkGeometry(dims).margin;
  // Some bundlers wrap inner functions in a __name(fn, "name") helper that
  // only exists in the bundle; the stand-in keeps the source text runnable.
  return `(() => {
  const __name = (fn) => fn;
  const pick = ${pickBadgeCorner.toString()};
  const slides = document.querySelectorAll(".hx-slide");
  for (let i = 0; i < slides.length; i++) {
    const badge = slides[i].querySelector("[data-tq-badge]");
    if (!badge) continue;
    const c = pick(slides[i], ${box}, ${side});
    badge.style.left = ""; badge.style.right = ""; badge.style.top = ""; badge.style.bottom = "";
    badge.style[c.h] = "${m}px";
    badge.style[c.v] = "${m}px";
  }
})()`;
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
  opts: { cover?: boolean; corner?: BadgeCorner } = {},
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
  const corner = opts.corner ?? defaultBadgeCorner(lang);
  return `<div data-tq-badge dir="ltr" style="position:absolute;${corner.h}:${g.margin}px;${corner.v}:${g.margin}px;height:${g.height}px;display:flex;align-items:center;gap:${g.gap}px;padding:0 ${g.padX}px 0 ${Math.round(g.padX * 0.55)}px;border-radius:${g.height}px;background:rgba(10,10,10,0.6);opacity:${WATERMARK_OPACITY};font-family:'Cairo',sans-serif;font-size:${g.fontSize}px;line-height:1;white-space:nowrap;color:${BRAND.text};z-index:2147483646">${barsIconSvg(g.icon)}<span style="font-weight:600">${esc(WATERMARK_TEXT)}</span><span style="font-weight:800;margin-inline-start:-${Math.round(g.gap * 0.6)}px">${esc(WATERMARK_BRAND)}</span></div>`;
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

/**
 * The watermark as a standalone image (SVG data URI) + its slide-pixel box,
 * for the EDITABLE free PPTX (2026-10-05 free trial): a picture keeps its
 * transparency through dom-to-pptx, where a translucent CSS fill would not.
 * Same geometry, opacity and corner as watermarkHtml. The text uses a
 * system sans-serif (webfonts don't load inside an <img> SVG).
 */
export function watermarkImage(
  lang: BrandLang,
  dims: SlideDims,
  corner: BadgeCorner = defaultBadgeCorner(lang),
): { src: string; x: number; y: number; width: number; height: number } {
  const base = watermarkGeometry(dims);
  const h = Math.round(base.height * 0.8);
  const icon = Math.round(base.icon * 0.8);
  const fontSize = Math.round(base.fontSize * 0.8);
  const padX = Math.round(base.padX * 0.8);
  const gap = Math.round(base.gap * 0.8);
  const width = Math.round(h * 5.5);
  const textX = Math.round(padX * 0.55) + icon + gap;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<g opacity="${WATERMARK_OPACITY}">` +
    `<rect width="${width}" height="${h}" rx="${h / 2}" fill="#0A0A0A" fill-opacity="0.6"/>` +
    `<g transform="translate(${Math.round(padX * 0.55)},${Math.round((h - icon) / 2)})">${barsIconSvg(icon)}</g>` +
    `<text x="${textX}" y="${Math.round(h / 2)}" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#FFFFFF">` +
    `<tspan font-weight="600">${esc(WATERMARK_TEXT)} </tspan><tspan font-weight="800">${esc(WATERMARK_BRAND)}</tspan></text>` +
    `</g></svg>`;
  const x = corner.h === "left" ? base.margin : dims.width - base.margin - width;
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    x,
    y: corner.v === "top" ? base.margin : dims.height - base.margin - h,
    width,
    height: h,
  };
}

