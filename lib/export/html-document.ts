import type { SlideManifest } from "@/lib/schema/slide";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";

/**
 * Builds a single self-contained HTML document containing every slide of the
 * deck stacked vertically at full 1920×1080. Used for the "download as HTML"
 * button so the user can open the file in a browser, resize to 1920 px, and
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
  const fontLinks = [manifest.theme.fontHeading.url, manifest.theme.fontBody.url]
    .filter(
      (url, i, arr): url is string =>
        typeof url === "string" && arr.indexOf(url) === i
    )
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`
    )
    .join("\n  ");

  const palette = manifest.theme.palette;
  const cssVarLines: string[] = [
    `--brand-bg: ${manifest.theme.background};`,
    `--brand-text: ${manifest.theme.text};`,
    `--font-heading: "${manifest.theme.fontHeading.name}", system-ui, sans-serif;`,
    `--font-body: "${manifest.theme.fontBody.name}", system-ui, sans-serif;`,
    ...palette.map((hex, i) => `--brand-${i + 1}: ${hex};`),
  ];
  if (palette[0]) cssVarLines.push(`--primary: ${palette[0]};`);
  if (palette[1]) cssVarLines.push(`--secondary: ${palette[1]};`);
  if (palette[2]) cssVarLines.push(`--accent: ${palette[2]};`);

  const cssVars = cssVarLines.map((l) => `    ${l}`).join("\n");

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
