// Phase 17.A — Typeface extraction from PPTX theme XML.
//
// PPTX themes encode the deck's "brand fonts" in two slots:
//
//   ppt/theme/theme1.xml
//     <a:fontScheme>
//       <a:majorFont>                  ← headings
//         <a:latin typeface="Cairo"/>
//         <a:ea    typeface="..."/>    ← East Asian (rare in our flows)
//         <a:cs    typeface="Cairo"/>  ← complex script (Arabic, Hebrew)
//       </a:majorFont>
//       <a:minorFont>                  ← body text
//         ...same shape...
//       </a:minorFont>
//     </a:fontScheme>
//
// For Taqreer (Arabic-first product), the `<a:cs>` typeface is the
// one that matters most — it's the font PowerPoint uses to render
// Arabic runs. We collect ALL three slots (latin/ea/cs) from BOTH
// fonts (major + minor) and dedupe by family name. Claude can decide
// which to apply where; we don't try to be clever about heading vs.
// body separation at this layer.
//
// ─── Why theme1.xml only ──────────────────────────────────────────
// PPTX can carry multiple theme files (theme1..themeN) when the deck
// uses different slide masters, but in practice 99% of single-deck
// PPTXs have one theme. Reading just theme1.xml keeps the impl small
// and covers our use case. Slide-level font overrides (per-run rPr)
// are an exception path we don't try to reverse-engineer here —
// Claude reads the rasterized PNGs visually and can pick the right
// typography from there.

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

// ─── System font classification ───────────────────────────────────
//
// Some PPTX themes reference system / OS-bundled fonts (Arial,
// Helvetica, Calibri, Times New Roman, Tahoma, …) rather than a
// custom typeface. These need different handling downstream:
//
//   • SYSTEM fonts → Claude uses them verbatim in CSS font-family
//     stacks. No Google Font lookup, no fallback substitution.
//   • CUSTOM fonts → Claude treats the name as a hint, tries to
//     resolve to a matching Google Font (Cairo, Tajawal, Playfair
//     Display, etc.) or falls back to the closest visual cousin.
//
// The list below is lowercase normalized; we compare against the
// extracted typeface in lowercase to avoid "Arial" vs "arial"
// mismatches. Curated for the typefaces PowerPoint / Keynote /
// Google Slides actually emit by default on macOS, Windows, and
// Linux. Not exhaustive — when in doubt, we treat as custom and
// let Claude figure it out.
const SYSTEM_FONT_LOWERCASE = new Set([
  // macOS / iOS
  "helvetica",
  "helvetica neue",
  "san francisco",
  "lucida grande",
  "monaco",
  "menlo",
  "geneva",
  "courier",
  "courier new",
  // Windows / Office
  "arial",
  "arial black",
  "arial narrow",
  "calibri",
  "calibri light",
  "cambria",
  "candara",
  "consolas",
  "constantia",
  "corbel",
  "ebrima",
  "franklin gothic",
  "franklin gothic medium",
  "gabriola",
  "gadugi",
  "georgia",
  "impact",
  "lucida console",
  "lucida sans unicode",
  "ms sans serif",
  "ms serif",
  "palatino linotype",
  "segoe ui",
  "segoe ui historic",
  "sitka small",
  "sitka text",
  "sylfaen",
  "symbol",
  "tahoma",
  "times",
  "times new roman",
  "trebuchet ms",
  "verdana",
  "wingdings",
  // Cross-platform / generic CSS
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "cursive",
  "fantasy",
]);

export type ClassifiedFonts = {
  /** Family names that are OS-bundled (Arial, Helvetica, Calibri, …). */
  systemFonts: string[];
  /** Family names not in the system list — treated as custom hints. */
  customFonts: string[];
  /**
   * Original combined list in insertion order. Kept for
   * back-compat with callers that don't need the classification.
   */
  allFonts: string[];
};

/**
 * Classify an already-extracted typeface name list into system vs
 * custom. Exported so the dispatcher / deck-generate can both apply
 * the same rule when given a name from any source.
 */
export function classifyFontNames(names: string[]): ClassifiedFonts {
  const systemFonts: string[] = [];
  const customFonts: string[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (SYSTEM_FONT_LOWERCASE.has(key)) {
      systemFonts.push(name);
    } else {
      customFonts.push(name);
    }
  }
  return { systemFonts, customFonts, allFonts: names };
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Walk a PPTX zip's theme1.xml, return the unique typeface family
 * names referenced by the major + minor font schemes. Order is
 * stable: major-latin, major-ea, major-cs, minor-latin, minor-ea,
 * minor-cs — but only when each is present and unique.
 *
 * Returns an empty array (NOT throws) when the theme file is absent
 * or malformed — fonts are nice-to-have, not blocking. The caller
 * uses the array as a "preferred fonts" hint to Claude; an empty
 * hint just means Claude picks fonts based on the rasterized look.
 */
export async function extractFontsFromPptx(
  pptxBuffer: Buffer,
): Promise<string[]> {
  const zip = await JSZip.loadAsync(pptxBuffer);
  // PPTX produced by some tools (Keynote export, Google Slides
  // export) puts the theme at theme/themeOverride1.xml or similar.
  // Prefer the canonical path; fall back to the first theme*.xml
  // we find so we don't return [] for a perfectly valid deck.
  const themeFile =
    zip.file("ppt/theme/theme1.xml") ?? findFirstTheme(zip);
  if (!themeFile) return [];

  const themeXml = await themeFile.async("string");
  return parseTypefaces(themeXml);
}

// ─── Internals ─────────────────────────────────────────────────────

function findFirstTheme(zip: JSZip): JSZip.JSZipObject | null {
  let found: JSZip.JSZipObject | null = null;
  // Match any theme file under ppt/theme/. Catches the canonical
  // theme{N}.xml as well as the variants tools emit:
  //   • themeOverride{N}.xml (slide-master overrides; some Keynote
  //     and Google Slides exports)
  //   • theme{N}_override.xml (rare, OOXML 2007 quirks)
  // Anchored to a flat single file under ppt/theme/ (no subdir
  // traversal) so we don't accidentally pick up theme images.
  zip.forEach((relativePath, file) => {
    if (found) return;
    if (/^ppt\/theme\/theme[^/]*\.xml$/i.test(relativePath)) {
      found = file;
    }
  });
  return found;
}

/**
 * Parse `<a:fontScheme>` → majorFont + minorFont → latin/ea/cs
 * typeface attributes. Returns deduplicated family names in
 * insertion order.
 *
 * The XML uses the `a:` namespace prefix consistently across all
 * OOXML producers (it's the canonical prefix for drawingml). xmldom
 * matches by prefixed local name; getElementsByTagName("a:latin")
 * Just Works.
 */
function parseTypefaces(themeXml: string): string[] {
  const doc = new DOMParser().parseFromString(themeXml, "text/xml");
  const out: string[] = [];
  const seen = new Set<string>();

  // Order matters for the "preferred fonts" hint we hand Claude —
  // major first (headings) then minor (body), and within each,
  // latin/ea/cs in the OOXML standard order.
  const scopes = ["a:majorFont", "a:minorFont"] as const;
  const slots = ["a:latin", "a:ea", "a:cs"] as const;

  for (const scope of scopes) {
    const fontEls = doc.getElementsByTagName(scope);
    for (let i = 0; i < fontEls.length; i += 1) {
      const fontEl = fontEls.item(i);
      if (!fontEl) continue;
      for (const slot of slots) {
        const slotEls = fontEl.getElementsByTagName(slot);
        for (let j = 0; j < slotEls.length; j += 1) {
          const el = slotEls.item(j);
          if (!el) continue;
          const typeface = el.getAttribute("typeface");
          if (!typeface) continue;
          const trimmed = typeface.trim();
          // PPTX uses `+mj-lt` / `+mn-lt` "scheme references" as
          // typeface values inside per-run rPr blocks; theme files
          // themselves use real family names. Still, guard against
          // a scheme reference sneaking in.
          if (!trimmed || trimmed.startsWith("+")) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(trimmed);
        }
      }
    }
  }

  return out;
}
