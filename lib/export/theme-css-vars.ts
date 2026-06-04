// Single source of truth for theme → CSS-custom-property wiring.
//
// Both call sites (browser-render via `SlideRenderer` and downloadable
// HTML doc via `html-document.ts`) need the SAME set of variables on
// the slide root so Claude-authored slide HTML resolves `var(--brand-bg)`
// / `var(--primary)` / `var(--font-heading)` etc. identically in preview
// AND in the exported `.html` artifact. Previously the wiring was
// duplicated — SlideRenderer returned `React.CSSProperties`, html-document
// emitted CSS text lines — and the two could drift silently (e.g. adding
// a new palette alias in one without the other). This module returns a
// shape-neutral `Record<string, string>` that each consumer adapts to
// its target shape.
//
// Variables emitted:
//   --brand-bg            theme.background
//   --brand-text          theme.text
//   --font                "${name}", system-ui, sans-serif  (single brand font)
//   --font-heading        alias of --font  (legacy — old slide HTML refs it)
//   --font-body           alias of --font  (legacy — old slide HTML refs it)
//   --brand-1 .. --brand-N every palette entry, 1-indexed
//   --primary             palette[0] (alias)
//   --secondary           palette[1] (alias)
//   --accent              palette[2] (alias)

import type { ThemeType } from "@/lib/schema/slide";

// Escape a font-family NAME for safe use inside a DOUBLE-QUOTED CSS string
// AND inside an inline <style> element — WITHOUT dropping characters. The
// same name (e.g. `DIN NEXT™ ARABIC`) must be produced everywhere it's
// referenced: the `--font-*` custom property here AND the `@font-face`
// declaration for an uploaded font (DeckView + html-document-server). If one
// side strips `™` (or any char) and the other doesn't, the names disagree and
// the browser can't resolve the face — the uploaded font silently falls back
// to system-ui. So both sides call THIS, keeping them byte-identical.
//
// Neutralizes only what can break out of the quoted string / the <style>
// element: the backslash (escape char), the closing double-quote, and the
// `</style>` sequence (via `<`/`>`). The name comes from a font FILENAME
// (fontFamilyNameFromFile), which can't carry control chars or newlines, so
// there's nothing else to strip. Real font names never contain `<`/`>`, so
// escaping them is invisible in practice but closes the injection hole. Wrap
// the RESULT in double quotes.
export function cssFontFamilyName(name: string): string {
  return name
    .replace(/\\/g, "\\\\") // escape backslash FIRST
    .replace(/"/g, '\\"') // escape the string-closing quote
    .replace(/</g, "\\3c ") // neutralize a "</style>" breakout
    .replace(/>/g, "\\3e ");
}

export function themeToCssVars(theme: ThemeType): Record<string, string> {
  const fontStack = `"${cssFontFamilyName(theme.font.name)}", system-ui, sans-serif`;
  const vars: Record<string, string> = {
    "--brand-bg": theme.background,
    "--brand-text": theme.text,
    // Single brand font. `--font` is the canonical var Claude references;
    // `--font-heading`/`--font-body` stay as aliases so slide HTML authored
    // before the single-font collapse keeps resolving its font.
    "--font": fontStack,
    "--font-heading": fontStack,
    "--font-body": fontStack,
  };
  theme.palette.forEach((hex, i) => {
    vars[`--brand-${i + 1}`] = hex;
  });
  // Convenience aliases — Claude can use --primary / --accent / --secondary
  // without thinking about indexes.
  if (theme.palette[0]) vars["--primary"] = theme.palette[0];
  if (theme.palette[1]) vars["--secondary"] = theme.palette[1];
  if (theme.palette[2]) vars["--accent"] = theme.palette[2];
  return vars;
}
