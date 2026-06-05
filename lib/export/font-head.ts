import type { ThemeType } from "@/lib/schema/slide";
import { cssFontFamilyName } from "@/lib/export/theme-css-vars";

// Build the <head> font declarations for a deck's theme: a Google-font stylesheet
// <link> (theme.font.url) PLUS an @font-face per uploaded brand-font weight
// (theme.font.fontFaces). Mirrors the standalone HTML export
// (`html-document-server.buildHtmlDocumentServer`) so the in-canvas editor's iframe
// loads the EXACT same fonts the slides reference by name — without it, the iframe
// is its own document and falls back to a system font (wrong, esp. for Arabic).
//
// Returns `links` (the <link> tags, for <head>) and `faceCss` (the @font-face rules,
// for a <style> block). Values are app-controlled (Google URL + signed Supabase
// URLs + sanitised family name), escaped here the same way the export does.
export function buildDeckFontHead(theme: ThemeType): {
  links: string;
  faceCss: string;
} {
  const links = [theme.font.url]
    .filter(
      (url, i, arr): url is string =>
        typeof url === "string" && arr.indexOf(url) === i,
    )
    .map(
      (url) =>
        `<link rel="stylesheet" href="${escapeAttr(url)}" crossorigin="anonymous">`,
    )
    .join("\n  ");

  const seen = new Set<string>();
  const faceCss = [theme.font]
    .map((f) => ({ name: f.name?.trim() ?? "", faces: f.fontFaces ?? [] }))
    .filter(
      (f): f is { name: string; faces: { weight: number; src: string }[] } => {
        if (!f.name || f.faces.length === 0 || seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      },
    )
    .flatMap((f) =>
      f.faces.map(
        (face) =>
          `@font-face { font-family: "${cssFontFamilyName(f.name)}"; font-weight: ${face.weight}; src: url("${escapeCssValue(face.src)}"); font-display: swap; }`,
      ),
    )
    .join("\n");

  return { links, faceCss };
}

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
