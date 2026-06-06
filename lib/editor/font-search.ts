// Font search for the in-canvas editor's font-family picker. Searches the bundled
// Google Fonts catalog (no API key) and reuses the brand flow's css2 URL builder
// so a font picked here loads + embeds through the exact same pipeline as the
// deck's theme font.

import { GOOGLE_FONTS_CATALOG, type GoogleFontEntry } from "./google-fonts-catalog";
import { googleFontUrl } from "@/lib/brand/fonts";

export { googleFontUrl };
export type { GoogleFontEntry };

// Lowercase index for matching `font-family` values back to a catalog entry.
const BY_LOWER = new Map<string, GoogleFontEntry>(
  GOOGLE_FONTS_CATALOG.map((e) => [e.f.toLowerCase(), e]),
);

/**
 * Search the catalog. The catalog is pre-sorted Arabic-capable-first (this is an
 * Arabic deck tool), so an empty query returns that order. A query ranks
 * prefix-matches above substring-matches; within each, the catalog's
 * Arabic-first ordering is preserved.
 */
export function searchGoogleFonts(
  query: string,
  opts: { arabicOnly?: boolean; limit?: number } = {},
): GoogleFontEntry[] {
  const q = query.trim().toLowerCase();
  const limit = opts.limit ?? 80;
  const pool = opts.arabicOnly
    ? GOOGLE_FONTS_CATALOG.filter((e) => e.a === 1)
    : GOOGLE_FONTS_CATALOG;
  if (!q) return pool.slice(0, limit);
  const starts: GoogleFontEntry[] = [];
  const contains: GoogleFontEntry[] = [];
  for (const e of pool) {
    const name = e.f.toLowerCase();
    if (name.startsWith(q)) starts.push(e);
    else if (name.includes(q)) contains.push(e);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** True when `family` is a known Google Font (case-insensitive). */
export function isGoogleFont(family: string): boolean {
  return BY_LOWER.has(family.trim().toLowerCase());
}

/** The canonical-cased catalog family for a (possibly mis-cased) name, or null. */
export function canonicalFamily(family: string): string | null {
  return BY_LOWER.get(family.trim().toLowerCase())?.f ?? null;
}

/**
 * Catalog families referenced by `font-family` declarations in a slide's HTML
 * (inline styles or <style> rules). The render + export paths use this to inject
 * exactly the css2 <link>s a slide needs — mirroring how the theme font is
 * injected by TRUSTED code (never into sanitized user HTML), so DOMPurify never
 * has to allow a font URL.
 */
export function usedGoogleFonts(html: string): string[] {
  if (!html) return [];
  // Normalize entity-escaped quotes (serialized inline styles carry &quot;) so
  // the first family resolves the same whether it came from an attribute or a
  // raw <style> rule.
  const norm = html
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'");
  const found = new Set<string>();
  // Capture only the FIRST family in the stack — quoted ("Name" / 'Name') or
  // bare (stops at comma / semicolon / brace / quote).
  const re = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,;}"']+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const first = (m[1] || m[2] || m[3] || "").trim();
    const entry = BY_LOWER.get(first.toLowerCase());
    if (entry) found.add(entry.f);
  }
  return [...found];
}

/** css2 <link> tags for the Google Fonts a slide uses — drop into a <head>. */
export function googleFontLinkTags(html: string): string {
  return usedGoogleFonts(html)
    .map(
      (f) =>
        `<link rel="stylesheet" href="${googleFontUrl(f)}" crossorigin="anonymous">`,
    )
    .join("\n");
}

/**
 * One css2 URL that loads the DEFAULT weight of MANY families at once — for the
 * picker's live previews (a single request for the whole visible list, rather
 * than one <link> per row). Not for applying: the apply path uses
 * `googleFontUrl()` with the full weight ladder.
 */
export function previewCss2Url(families: string[]): string {
  const fams = families
    .slice(0, 64)
    .map((f) => `family=${f.replace(/ /g, "+")}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}
