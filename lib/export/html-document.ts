import type { SlideManifest } from "@/lib/schema/slide";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { googleFontLinkTags } from "@/lib/editor/font-search";

/**
 * Builds a single self-contained HTML document containing every slide of the
 * deck stacked vertically at the manifest's canvas size (16:9 → 1920×1080,
 * 9:16 → 1080×1920). Used for the "download as HTML" button so the user can
 * open the file in a browser, resize to the deck's native width, and
 * screenshot each slide cleanly without dom-to-pptx in the picture.
 *
 * The document mirrors what the in-app preview renders: the same theme CSS
 * vars on each slide root, the same font <link>s, the same dir/lang.
 *
 * Each slide's HTML is sanitised via the same DOMPurify config the preview
 * uses (`lib/export/sanitize.ts`). Without this, opening the downloaded file
 * would execute any <script>/event-handler/javascript: URI Claude emitted —
 * a real XSS vector in the export-as-HTML path. Pre-launch hardening will
 * move sanitisation upstream to `inngest/functions/deck-generate.ts`; until
 * then this client-side pass is the only line of defence on this code path.
 *
 * Must be called from a browser context only — `sanitizeSlideHtml` calls the
 * DOMPurify factory with the live `window`. `downloadHtmlDocument` below is
 * the only intended caller and is browser-triggered.
 */
export function buildHtmlDocument(manifest: SlideManifest): string {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(manifest.format);
  const fontLinks = [manifest.theme.font.url]
    .filter(
      (url, i, arr): url is string =>
        typeof url === "string" && arr.indexOf(url) === i
    )
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`
    )
    .join("\n  ");

  // Per-element fonts picked in the editor (font-search) — emit each catalog
  // family's css2 <link> so the downloaded HTML renders them. Trusted code.
  const pickedFontLinks = googleFontLinkTags(
    manifest.slides.map((s) => s.html).join("\n"),
  );

  // Shared source of truth — same record SlideRenderer spreads into its
  // inline style. Adapt to CSS-text-string lines for the <style> block.
  const cssVarRecord = themeToCssVars(manifest.theme);
  const cssVars = Object.entries(cssVarRecord)
    .map(([k, v]) => `    ${k}: ${escapeCssValue(v)};`)
    .join("\n");

  const slides = manifest.slides
    .map(
      (s) =>
        `<div class="hx-slide" dir="${manifest.direction}" lang="${
          manifest.language
        }" data-slide-id="${escapeAttr(s.slideId)}">\n${sanitizeSlideHtml(
          s.html
        )}\n</div>`
    )
    .join("\n\n");

  return `<!DOCTYPE html>
<html dir="${manifest.direction}" lang="${manifest.language}">
<head>
<meta charset="UTF-8">
<title>${escapeText(manifest.title)}</title>
${fontLinks}
${pickedFontLinks}
<style>
  :root {
${cssVars}
  }
  body {
    margin: 0;
    padding: 24px 0;
    background: #0D0B1F;
    font-family: var(--font-body);
    color: var(--brand-text);
  }
  .hx-slide {
    width: ${canvasW}px;
    height: ${canvasH}px;
    margin: 0 auto 24px;
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

// CSS-value escape for `<style>` block injection. Theme fields
// (background hex, font name) flow from a Zod-validated manifest, but
// the values eventually round-trip from Claude's free text — a stray
// `</style>` substring in a font name (or a malicious hex with newline
// + `</style>` injection) would prematurely close the style block and
// leak whatever follows as HTML. Neutralise the two attack surfaces:
//   • `</style` → `<\/style` (escaped solidus is a no-op inside CSS
//     but breaks the parser's exit-tag match)
//   • newlines / form-feeds → space (line-terminating chars can break
//     declarations and create injection windows in some parsers)
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

export function downloadHtmlDocument(
  manifest: SlideManifest,
  fileName: string
): void {
  const html = buildHtmlDocument(manifest);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
