// Deck-wide font change after generation (2026-10-03). No AI call: swaps the
// theme font (the --font var most slide CSS uses) AND rewrites every literal
// family inside font-family declarations, because generated slides also hard-
// code names like 'Cairo' next to (or instead of) var(--font).
//
// Pure string-in / string-out on font-family values only: the replacement is
// a catalog family name (validated by the caller) wrapped in quotes, so the
// output can never gain markup. Generic families (sans-serif ...), var()
// references and icon fonts are kept.

import type { SlideManifest } from "@/lib/schema/slide";
import { googleFontUrl } from "@/lib/brand/fonts";
import { cssFontFamilyName } from "@/lib/export/theme-css-vars";

const GENERIC = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math",
  "fangsong", "inherit", "initial", "unset", "revert", "revert-layer",
  "-apple-system", "blinkmacsystemfont",
]);
const ICON_FONT = /icon|symbol|awesome|emoji/i;

// font-family: <value>, the value ending at ; } " or < (HTML entities such as
// &quot; are part of the value, not a terminator).
const FONT_FAMILY_RE = /(font-family\s*:\s*)((?:&quot;|&#39;|&#x27;|[^;"}<])+)/gi;

const unquote = (token: string) =>
  token
    .trim()
    .replace(/^(&quot;|&#39;|&#x27;|["'])/, "")
    .replace(/(&quot;|&#39;|&#x27;|["'])$/, "")
    .trim();

/** Rewrites the named families in every font-family declaration to `family`. */
export function refontText(text: string, family: string): string {
  const quoted = `'${cssFontFamilyName(family).replace(/'/g, "\\'")}'`;
  return text.replace(FONT_FAMILY_RE, (match, prefix: string, value: string) => {
    const trailing = value.match(/\s*(!important)?\s*$/)?.[0] ?? "";
    const body = value.slice(0, value.length - trailing.length);
    let placed = false;
    const out: string[] = [];
    for (const raw of body.split(",")) {
      const token = raw.trim();
      if (!token) continue;
      const name = unquote(token);
      const keep =
        token.startsWith("var(") ||
        GENERIC.has(name.toLowerCase()) ||
        ICON_FONT.test(name);
      if (keep) {
        out.push(token);
      } else if (!placed) {
        out.push(quoted);
        placed = true;
      }
    }
    if (!placed) return match;
    return `${prefix}${out.join(",")}${trailing}`;
  });
}

/** The whole manifest on a new Google family (validated canonical name). */
export function refontManifest(manifest: SlideManifest, family: string): SlideManifest {
  return {
    ...manifest,
    theme: {
      ...manifest.theme,
      // A Google family replaces any uploaded brand font faces.
      font: { name: family, url: googleFontUrl(family) },
    },
    slides: manifest.slides.map((s) => ({ ...s, html: refontText(s.html, family) })),
  };
}
