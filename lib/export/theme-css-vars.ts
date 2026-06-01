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
//   --font-heading        "${name}", system-ui, sans-serif
//   --font-body           "${name}", system-ui, sans-serif
//   --brand-1 .. --brand-N every palette entry, 1-indexed
//   --primary             palette[0] (alias)
//   --secondary           palette[1] (alias)
//   --accent              palette[2] (alias)

import type { ThemeType } from "@/lib/schema/slide";

export function themeToCssVars(theme: ThemeType): Record<string, string> {
  const vars: Record<string, string> = {
    "--brand-bg": theme.background,
    "--brand-text": theme.text,
    "--font-heading": `"${theme.fontHeading.name}", system-ui, sans-serif`,
    "--font-body": `"${theme.fontBody.name}", system-ui, sans-serif`,
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
