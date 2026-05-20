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
// Currently the ONLY caller is the thumbnail-render Inngest function
// (lib/export/html-document.ts stays the source of truth for the
// "download as HTML" button — different lifecycle, different env).
// Keep the two templates in lockstep: a divergence between this and
// the browser variant would produce thumbnails that don't match the
// live preview.

import type { SlideManifest } from "@/lib/schema/slide";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { sanitizeSlideHtmlServer } from "@/lib/export/sanitize-server";
import { themeToCssVars } from "@/lib/export/theme-css-vars";

export function buildHtmlDocumentServer(manifest: SlideManifest): string {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(
    manifest.format,
  );
  const fontLinks = [manifest.theme.fontHeading.url, manifest.theme.fontBody.url]
    .filter(
      (url, i, arr): url is string =>
        typeof url === "string" && arr.indexOf(url) === i,
    )
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`,
    )
    .join("\n  ");

  const cssVarRecord = themeToCssVars(manifest.theme);
  const cssVars = Object.entries(cssVarRecord)
    .map(([k, v]) => `    ${k}: ${escapeCssValue(v)};`)
    .join("\n");

  const slides = manifest.slides
    .map(
      (s) =>
        `<div class="hx-slide" dir="${manifest.direction}" lang="${
          manifest.language
        }" data-slide-id="${escapeAttr(s.slideId)}">\n${sanitizeSlideHtmlServer(
          s.html,
        )}\n</div>`,
    )
    .join("\n\n");

  return `<!DOCTYPE html>
<html dir="${manifest.direction}" lang="${manifest.language}">
<head>
<meta charset="UTF-8">
<title>${escapeText(manifest.title)}</title>
${fontLinks}
<style>
  :root {
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
  }
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
