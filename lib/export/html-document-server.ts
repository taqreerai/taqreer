// Server-side counterpart to `lib/export/html-document.ts`.
//
// Produces a single self-contained HTML document that stacks every
// slide at its canvas size — identical structure / styling / sanitised
// content to what the browser-side `buildHtmlDocument` returns, so a
// Puppeteer screenshot taken against this output matches what the
// user sees in the live preview.
//
// Why not reuse `buildHtmlDocument` directly: it calls the
// browser-only `sanitizeSlideHtml` (DOMPurify with `window`), which
// errors on the Node side. This module mirrors the same template but
// routes each slide through `sanitizeSlideHtmlServer` (JSDOM-backed).
//
// Callers today:
//   • thumbnail-render Inngest function (per-slide PNG → WebP)
//   • PNG export route (per-slide PNG, zipped)
//   • PDF export route (multi-page PDF — passes `{ printPageBreaks }`
//     so Puppeteer's `page.pdf()` paginates one slide per page at the
//     canvas dimensions)
// (lib/export/html-document.ts stays the source of truth for the
// "download as HTML" button — different lifecycle, different env.)
// Keep the two templates in lockstep: a divergence between this and
// the browser variant would produce thumbnails that don't match the
// live preview.

import type { SlideManifest } from "@/lib/schema/slide";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { sanitizeSlideHtmlServer } from "@/lib/export/sanitize-server";
import { themeToCssVars, cssFontFamilyName } from "@/lib/export/theme-css-vars";
import { googleFontLinkTags } from "@/lib/editor/font-search";

export type HtmlDocumentServerOptions = {
  // When true, emit `@page { size: <canvas-dims>; margin: 0 }` +
  // `.hx-slide { page-break-after: always }`. Puppeteer's `page.pdf()`
  // honours these so the resulting PDF is one slide per page at the
  // exact canvas dimensions (1920×1080 landscape or 1080×1920
  // portrait). Default false because thumbnail / PNG callers want a
  // single long page they screenshot from, not paginated print
  // output.
  printPageBreaks?: boolean;
  // Free-tier branding (2026-07-13): stamp a "Designed by taqreer.ai"
  // pill on each slide's bottom end. STRICTLY opt-in and default false:
  // the bake/vision-revision loop and the thumbnail pipeline share this
  // builder and must render the TRUE deck (the vision model may never
  // see a watermark it would try to "fix"). Only the export routes pass
  // true, gated on the deck OWNER being on the free plan. The badge is
  // emitted OUTSIDE sanitizeSlideHtmlServer's output, so it is never
  // part of (or persisted into) the slide HTML itself.
  watermark?: boolean;
};

export function buildHtmlDocumentServer(
  manifest: SlideManifest,
  options: HtmlDocumentServerOptions = {},
): string {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(
    manifest.format,
  );
  const fontLinks = [manifest.theme.font.url]
    .filter(
      (url, i, arr): url is string =>
        typeof url === "string" && arr.indexOf(url) === i,
    )
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`,
    )
    .join("\n  ");

  // Uploaded brand font: emit a direct @font-face per WEIGHT carrying a signed
  // `fontFaces[].src` (deck-generate attached one per uploaded weight by
  // matching the family name → uploaded storageUrls), so the slides — which
  // reference the family by NAME and vary font-weight — render each weighted
  // run in the matching uploaded file. Name sanitised so it can't break out of
  // the CSS; src is a URL we signed.
  const fontFaceSeen = new Set<string>();
  const fontFaceCss = [manifest.theme.font]
    .map((f) => ({
      // Carry the RAW family name (just trimmed); escape it at emit time with
      // the SAME cssFontFamilyName() the --font* vars use, so the @font-face
      // family and `font-family: var(--font)` resolve identically.
      name: f.name?.trim() ?? "",
      faces: f.fontFaces ?? [],
    }))
    .filter((f): f is { name: string; faces: { weight: number; src: string }[] } => {
      if (!f.name || f.faces.length === 0 || fontFaceSeen.has(f.name)) return false;
      fontFaceSeen.add(f.name);
      return true;
    })
    .flatMap((f) =>
      f.faces.map(
        (face) =>
          `  @font-face { font-family: "${cssFontFamilyName(f.name)}"; font-weight: ${face.weight}; src: url("${escapeCssValue(face.src)}"); font-display: swap; }`,
      ),
    )
    .join("\n");

  // Per-element fonts the user picked in the editor (font-search). Scan every
  // slide's HTML for catalog families and emit their css2 <link>s into the head
  // so the export renders them AND the PPTX embeds them (dom-to-pptx fetches
  // whatever the page has loaded). Trusted code, never into sanitized content.
  const pickedFontLinks = googleFontLinkTags(
    manifest.slides.map((s) => s.html).join("\n"),
  );

  const cssVarRecord = themeToCssVars(manifest.theme);
  const cssVars = Object.entries(cssVarRecord)
    .map(([k, v]) => `    ${k}: ${escapeCssValue(v)};`)
    .join("\n");

  // Trusted literal (never user content), appended after the sanitized
  // slide HTML inside each .hx-slide. Same visual treatment as the
  // studio's .tq-watermark pill, at canvas scale.
  const watermarkHtml = options.watermark
    ? `<div class="hx-watermark">Designed by taqreer.ai</div>`
    : "";

  const slides = manifest.slides
    .map(
      (s) =>
        `<div class="hx-slide" dir="${manifest.direction}" lang="${
          manifest.language
        }" data-slide-id="${escapeAttr(s.slideId)}">\n${sanitizeSlideHtmlServer(
          s.html,
        )}\n${watermarkHtml}</div>`,
    )
    .join("\n\n");

  // Pagination rules — emitted only when the caller asks for them.
  // Only `page-break-after` is set here; the actual PDF page size is
  // driven from `page.pdf({ width, height })` in the route (`@page
  // size` declarations turned out to conflict with the explicit
  // dimensions on 9:16 portrait — Chrome's print path produced
  // 0-byte / blank PDFs when both were set, user-flagged
  // 2026-05-21). `margin: 0` on @page still helps belt-and-suspender
  // edge-to-edge layout. The `break-after: page` line is the
  // modern alias of the legacy `page-break-after: always` —
  // shipping both for compat across Chromium versions.
  const pageBreakCss = options.printPageBreaks
    ? `
  @page {
    margin: 0;
  }
  .hx-slide {
    page-break-after: always;
    break-after: page;
  }
  .hx-slide:last-child {
    page-break-after: auto;
    break-after: auto;
  }`
    : "";

  return `<!DOCTYPE html>
<html dir="${manifest.direction}" lang="${manifest.language}">
<head>
<meta charset="UTF-8">
<title>${escapeText(manifest.title)}</title>
${fontLinks}
${pickedFontLinks}
<style>
${fontFaceCss ? `${fontFaceCss}\n` : ""}  :root {
${cssVars}
  }
  body {
    margin: 0;
    padding: 0;
    background: var(--brand-bg);
    font-family: var(--font-body);
    color: var(--brand-text);
  }
  .hx-slide {
    width: ${canvasW}px;
    height: ${canvasH}px;
    background: var(--brand-bg);
    position: relative;
    overflow: hidden;
  }${
    options.watermark
      ? `
  /* Free-tier branding pill - white bg, black text, 80% opacity (mirror
     of the studio's .tq-watermark, scaled up for the 1920px canvas).
     inset-inline-end follows the slide's dir attribute. */
  .hx-watermark {
    position: absolute;
    inset-inline-end: 32px;
    bottom: 32px;
    z-index: 2147483647;
    padding: 8px 18px;
    border-radius: 9999px;
    background: #fff;
    border: 2px solid rgba(0, 0, 0, 0.10);
    color: #000;
    font-family: system-ui, sans-serif;
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
    opacity: 0.8;
  }`
      : ""
  }${pageBreakCss}
</style>
</head>
<body>
${slides}
</body>
</html>`;
}

// CSS-value escape — same reasoning as html-document.ts:escapeCssValue.
// Theme strings round-trip from Claude; a `</style>` substring in a
// font name would prematurely close the style block.
function escapeCssValue(value: string): string {
  return value
    .replace(/<\/style/gi, "<\\/style")
    .replace(/[\r\n\f]/g, " ");
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
