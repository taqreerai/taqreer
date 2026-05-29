// Build the 3-slide brand-showcase HTML document for a Template.
//
// Output mirrors the structure of `buildHtmlDocumentServer`: a single
// HTML doc with 3 `<div class="hx-slide" data-slide-id="...">` blocks,
// each sized at the brand's canvas dimensions. That lets the showcase
// render pipeline (template-showcase-render Inngest function) reuse
// the same Puppeteer per-slide screenshot loop as thumbnail-render —
// no second render path to maintain.
//
// The three slides, in order:
//   showcase-01-cover      — Big template title + accent bars. Defines
//                            the brand's "first impression" feel.
//   showcase-02-typography — Heading font name set in the heading font
//                            (very large), body font name set in the
//                            body font, with a PANGRAM beneath each
//                            so the user judges typographic personality
//                            against real text shapes (every glyph at
//                            least once).
//   showcase-03-palette    — Color swatches as edge-to-edge bands
//                            (coolors.co-style), each with its hex
//                            code in auto-contrast text.
//
// (Was 4 slides until 2026-05-22 — an abstract layout sample was
// retired because its geometric blocks competed with the cover's
// composition without adding distinct information about the brand.)
//
// All three slides:
//   • Render at the brand's exact canvas size (no resize, so the PNGs
//     are screenshot-accurate at 1920×1080 or 1080×1920).
//   • Honour the brand's direction (rtl/ltr) on the root element so
//     copy + flex / grid mirror correctly.
//   • Use the brand's webfonts via <link> in the document head — same
//     load path the live deck uses, so the screenshot waits on
//     document.fonts.ready and captures the real fonts (no fallback).
//
// Self-contained: no project content (titles, body copy, logos) leaks
// in. Copy on the slides is either label text (font name, hex value)
// or generic placeholders ("AaBbCc 123") that read the same for every
// brand.

import type { BrandSnapshot } from "@/lib/template/derive-brand";
import { dimensionsForFormat } from "@/lib/schema/slide";

// Stable slide IDs — the showcase-render pipeline queries
// [data-slide-id="..."] to clip each slide. Don't change these without
// updating the render function in lockstep.
export const SHOWCASE_SLIDE_IDS = [
  "showcase-01-cover",
  "showcase-02-typography",
  "showcase-03-palette",
] as const;
// `ShowcaseSlideId` (derived type) removed 2026-05-25 — no importer.
// If a caller needs the union, re-derive as
// `(typeof SHOWCASE_SLIDE_IDS)[number]` at the use site.

export function buildShowcaseHtml(
  brand: BrandSnapshot,
  templateTitle: string,
): string {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(brand.format);
  const isRtl = brand.direction === "rtl";

  const fontLinks = uniqueFontUrls(brand)
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`,
    )
    .join("\n  ");

  // CSS variables: same names as themeToCssVars (--brand-bg, --brand-text,
  // --font-heading, --font-body, --brand-1..N + --primary/--secondary/
  // --accent aliases) so the showcase styles stay legible against any
  // shared style helpers we add later.
  const paletteVars = brand.palette
    .map((hex, i) => `    --brand-${i + 1}: ${escapeCssValue(hex)};`)
    .join("\n");
  const primary = brand.palette[0] ?? brand.text;
  const secondary = brand.palette[1] ?? brand.text;
  const accent = brand.palette[2] ?? primary;

  return `<!DOCTYPE html>
<html dir="${brand.direction}" lang="${brand.language}">
<head>
<meta charset="UTF-8">
<title>${escapeText(templateTitle)}</title>
${fontLinks}
<style>
  :root {
    --brand-bg: ${escapeCssValue(brand.background)};
    --brand-text: ${escapeCssValue(brand.text)};
    --font-heading: "${escapeCssValue(brand.fontHeading.name)}", system-ui, sans-serif;
    --font-body: "${escapeCssValue(brand.fontBody.name)}", system-ui, sans-serif;
${paletteVars}
    --primary: ${escapeCssValue(primary)};
    --secondary: ${escapeCssValue(secondary)};
    --accent: ${escapeCssValue(accent)};
  }
  body {
    margin: 0;
    padding: 0;
    background: var(--brand-bg);
    color: var(--brand-text);
    font-family: var(--font-body);
  }
  .hx-slide {
    width: ${canvasW}px;
    height: ${canvasH}px;
    background: var(--brand-bg);
    color: var(--brand-text);
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
  }
  ${showcaseStyles(isRtl)}
</style>
</head>
<body>
${renderCoverSlide(templateTitle, isRtl)}

${renderTypographySlide(brand, isRtl)}

${renderPaletteSlide(brand, isRtl)}
</body>
</html>`;
}

// ─── Per-slide renderers ──────────────────────────────────────────────

function renderCoverSlide(title: string, isRtl: boolean): string {
  return `<div class="hx-slide showcase-cover" dir="${isRtl ? "rtl" : "ltr"}" data-slide-id="showcase-01-cover">
  <div class="showcase-cover__accent showcase-cover__accent--1"></div>
  <div class="showcase-cover__accent showcase-cover__accent--2"></div>
  <div class="showcase-cover__inner">
    <div class="showcase-cover__eyebrow">${isRtl ? "قالب" : "TEMPLATE"}</div>
    <h1 class="showcase-cover__title">${escapeText(title)}</h1>
  </div>
</div>`;
}

function renderTypographySlide(brand: BrandSnapshot, isRtl: boolean): string {
  // PANGRAMS — every glyph at least once so the user judges typographic
  // personality against full character coverage instead of a 7-letter
  // alphabet snippet. The Arabic line is a well-known pangram by
  // Al-Mutanabbi's structure ("a wise text…"); the English line is
  // the Wikipedia-canonical fox/dog example. Long enough to wrap
  // across multiple lines at the heading sample size, which is what
  // actually shows how the type sets in real copy.
  const sample = isRtl
    ? "نص حكيم له سر قاطع وذو شأن عظيم مكتوب على ثوب أخضر ومغلف بجلد أزرق"
    : "The quick brown fox jumps over the lazy dog 0123456789";
  const headingLabel = isRtl ? "الخط الرئيسي" : "Heading";
  const bodyLabel = isRtl ? "خط النص" : "Body";
  return `<div class="hx-slide showcase-typography" dir="${isRtl ? "rtl" : "ltr"}" data-slide-id="showcase-02-typography">
  <div class="showcase-typography__row">
    <div class="showcase-typography__label">${headingLabel}</div>
    <div class="showcase-typography__heading-name">${escapeText(brand.fontHeading.name)}</div>
    <div class="showcase-typography__heading-sample">${escapeText(sample)}</div>
  </div>
  <div class="showcase-typography__divider"></div>
  <div class="showcase-typography__row">
    <div class="showcase-typography__label">${bodyLabel}</div>
    <div class="showcase-typography__body-name">${escapeText(brand.fontBody.name)}</div>
    <div class="showcase-typography__body-sample">${escapeText(sample)}</div>
  </div>
</div>`;
}

function renderPaletteSlide(brand: BrandSnapshot, isRtl: boolean): string {
  // Coolors.co-style: edge-to-edge vertical bands, one per palette
  // color, hex code centered on each band. Bands divide the canvas
  // width evenly via flex:1 so any palette (3–8 colors) fills the
  // slide perfectly. Hex text colour is auto-contrasted from band
  // luminance so the code stays legible regardless of band darkness.
  //
  // Order: palette as Claude gave it (palette[0] first). For RTL we
  // intentionally keep visual-left → visual-right band order to match
  // the canonical coolors.co reading — the hex codes themselves are
  // already pinned LTR, so reversing would only confuse "which colour
  // is palette[0]" when the user inspects the manifest later.
  //
  // We dedupe case-insensitively so a palette that repeats the
  // background or text chrome (common when Claude uses a single
  // shared hex for "primary surface") doesn't render two identical
  // bands side by side.
  const uniqueHexes: string[] = [];
  const seen = new Set<string>();
  for (const hex of brand.palette) {
    const key = hex.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueHexes.push(hex);
    }
  }
  const bands = uniqueHexes
    .map((hex) => {
      const onColor = contrastingTextColor(hex);
      return `  <div class="showcase-palette__band" style="background: ${escapeCssValue(hex)}; color: ${onColor};">
    <div class="showcase-palette__band-hex" dir="ltr">${escapeText(hex.toUpperCase())}</div>
  </div>`;
    })
    .join("\n");
  return `<div class="hx-slide showcase-palette" dir="${isRtl ? "rtl" : "ltr"}" data-slide-id="showcase-03-palette">
${bands}
</div>`;
}

// WCAG-style relative luminance → "use white-on-this-band or
// black-on-this-band?" decision. The 0.55 threshold (vs the textbook
// 0.5) biases toward white text on near-50%-luminance bands because
// white text reads slightly clearer than black on most mid-tones
// against a screen backlight.
function contrastingTextColor(hex: string): string {
  const normalised = hex.replace(/^#/, "");
  if (normalised.length !== 6) return "#FFFFFF";
  const r = parseInt(normalised.slice(0, 2), 16);
  const g = parseInt(normalised.slice(2, 4), 16);
  const b = parseInt(normalised.slice(4, 6), 16);
  // Per-channel sRGB → linear conversion before luminance weighting.
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.55 ? "#0A0A0A" : "#FFFFFF";
}

// (The 4th `renderLayoutSlide` function — an abstract block-layout
// preview — was retired on 2026-05-22 because the geometric blocks
// competed with the cover slide's composition without adding distinct
// signal about the brand. See SHOWCASE_SLIDE_IDS above.)

// ─── Shared CSS ───────────────────────────────────────────────────────

function showcaseStyles(isRtl: boolean): string {
  // `start`/`end` margins so RTL/LTR mirror without separate stylesheets.
  // Padding values target a 1920×1080 canvas; on 1080×1920 portrait
  // they still look proportional because we use ems + viewport-relative
  // units only where they don't fight the fixed canvas size.
  const inset = isRtl ? "right" : "left";
  const insetOpposite = isRtl ? "left" : "right";
  return `
  /* Cover */
  .showcase-cover {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px;
  }
  .showcase-cover__accent {
    position: absolute;
    border-radius: 9999px;
    filter: blur(6px);
    opacity: 0.85;
  }
  .showcase-cover__accent--1 {
    width: 320px;
    height: 320px;
    background: var(--primary);
    top: -120px;
    ${inset}: -120px;
    opacity: 0.55;
  }
  .showcase-cover__accent--2 {
    width: 220px;
    height: 220px;
    background: var(--accent);
    bottom: -80px;
    ${insetOpposite}: -80px;
    opacity: 0.45;
  }
  .showcase-cover__inner {
    text-align: center;
    position: relative;
    z-index: 1;
  }
  .showcase-cover__eyebrow {
    font-family: var(--font-body);
    font-size: 24px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    opacity: 0.55;
    margin-bottom: 32px;
  }
  .showcase-cover__title {
    font-family: var(--font-heading);
    font-size: 140px;
    line-height: 1.05;
    margin: 0;
    font-weight: 700;
    color: var(--brand-text);
  }

  /* Typography — sizes bumped 2026-05-22 so the type samples read at
     real-presentation scale. Heading font NAME is the marquee (still
     huge), the SAMPLE pangram beneath jumped from 48px → 80px so the
     letter shapes are large enough to evaluate; body NAME bumped
     64 → 88px, body SAMPLE 32 → 52px. Line-height generous so the
     pangrams wrap cleanly across multiple lines on the 1920-wide
     canvas without crashing into adjacent rows. */
  .showcase-typography {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 96px 120px;
    gap: 56px;
  }
  .showcase-typography__row {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .showcase-typography__label {
    font-family: var(--font-body);
    font-size: 22px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    opacity: 0.5;
  }
  .showcase-typography__heading-name {
    font-family: var(--font-heading);
    font-size: 144px;
    line-height: 1;
    font-weight: 700;
    color: var(--brand-text);
  }
  .showcase-typography__heading-sample {
    font-family: var(--font-heading);
    font-size: 80px;
    line-height: 1.15;
    color: var(--primary);
    opacity: 0.9;
  }
  .showcase-typography__body-name {
    font-family: var(--font-body);
    font-size: 88px;
    line-height: 1.1;
    color: var(--brand-text);
  }
  .showcase-typography__body-sample {
    font-family: var(--font-body);
    font-size: 52px;
    line-height: 1.3;
    opacity: 0.75;
  }
  .showcase-typography__divider {
    height: 1px;
    background: var(--brand-text);
    opacity: 0.12;
  }

  /* Palette — coolors.co-style edge-to-edge vertical bands.
     The slide itself becomes a flex row; each band is flex:1 so
     widths auto-divide regardless of how many palette colours
     there are. No padding on the slide so the bands hit the
     canvas edges; the hex code is the only content per band. */
  .showcase-palette {
    display: flex;
    flex-direction: row;
    padding: 0;
    /* RTL slides default to row-reverse via the inherited dir;
       we want palette[0] on the visual LEFT for both directions
       (canonical coolors.co reading), so pin direction here. */
    direction: ltr;
  }
  .showcase-palette__band {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-body);
  }
  .showcase-palette__band-hex {
    font-size: 36px;
    letter-spacing: 0.08em;
    /* dir="ltr" on the element pins the reading order; isolate
       keeps the bidi algorithm from leaking the hash glyph into
       the surrounding RTL flow. */
    unicode-bidi: isolate;
    /* Per-band text colour wins via inline style — no opacity
       here so the high-contrast colour computed in
       contrastingTextColor() is preserved at full strength. */
  }

  /* (The .showcase-layout__* rules were removed on 2026-05-22 when
     the 4th slide was retired. No CSS for that slide remains.) */`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function uniqueFontUrls(brand: BrandSnapshot): string[] {
  const urls: string[] = [];
  if (brand.fontHeading.url) urls.push(brand.fontHeading.url);
  if (brand.fontBody.url && brand.fontBody.url !== brand.fontHeading.url) {
    urls.push(brand.fontBody.url);
  }
  return urls;
}

// Identical to html-document-server.ts escape helpers — kept inlined
// (rather than imported from there) to keep this builder self-contained
// and Node-safe for the renderer worker.
function escapeCssValue(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style").replace(/[\r\n\f]/g, " ");
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return c;
    }
  });
}
