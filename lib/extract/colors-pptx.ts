// Phase 17.A — Tier-1 brand color extraction from PPTX theme XML.
//
// Direct read of `<a:clrScheme>` from ppt/theme/theme1.xml. This is
// the "right way" to get a deck's brand palette when the deck has
// actually been themed — accent1..accent6 are the explicit color
// slots PowerPoint surfaces in the Design > Variants > Colors picker.
//
//   <a:clrScheme name="Custom 1">
//     <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
//     <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
//     <a:accent1><a:srgbClr val="4F46E5"/></a:accent1>
//     ...
//   </a:clrScheme>
//
// Returns null when the theme is the unmodified Office default
// (signals: user didn't pick brand colors, fall through to Tier-2
// histogram on rasterized PNGs which can still catch e.g. logo
// colors used as fills) OR when no theme exists. Otherwise returns
// the accent hex values in order.
//
// ─── Tier 1 vs Tier 2 ──────────────────────────────────────────────
// Tier 1 (this file): theme XML — fast, exact, gives the design
// intent. Misses brand colors set per-slide as fills.
// Tier 2 (colors-rasterized.ts): pixel histogram on rasterized PNGs
// — slower, fuzzier, but catches actual on-screen colors including
// logo embeds and per-slide overrides.
// Dispatcher (lib/extract/index.ts) tries Tier 1 first; falls through
// to Tier 2 when Tier 1 returns null.

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

// Office's default Variants > Colors scheme. If accent1..accent6
// match these EXACTLY, the user never customized the palette —
// returning these as "brand colors" would mislead the prompt.
const OFFICE_DEFAULT_ACCENTS = [
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
];

// PowerPoint's "Blank Presentation" template uses a different
// (older) default. Check for both.
const OFFICE_2013_DEFAULT_ACCENTS = [
  "5B9BD5",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "4472C4",
  "70AD47",
];

// ─── Public API ────────────────────────────────────────────────────

/**
 * Extract accent1..accent6 hex values from a PPTX theme. Returns
 * null when:
 *   • No theme exists in the zip
 *   • The clrScheme is missing or has no parseable accents
 *   • All accents match the Office default palette (user didn't
 *     customize — Tier 2 will likely find something more meaningful)
 *
 * @returns hex strings like ["#4F46E5", "#10B981", ...] — sRGB
 *   accents in PPTX accent1..accent6 order, uppercased. Length is
 *   1..6 depending on how many accents the theme defines (rare to
 *   see fewer than 6, but the OOXML schema doesn't mandate them).
 */
export async function extractColorsFromPptx(
  pptxBuffer: Buffer,
): Promise<string[] | null> {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const themeFile =
    zip.file("ppt/theme/theme1.xml") ?? findFirstTheme(zip);
  if (!themeFile) return null;

  const themeXml = await themeFile.async("string");
  const accents = parseAccents(themeXml);
  if (accents.length === 0) return null;

  // Match against known unmodified defaults. Compare uppercased so
  // case variants in the XML don't sneak through.
  const upperAccents = accents.map((c) => c.toUpperCase());
  if (matchesDefault(upperAccents, OFFICE_DEFAULT_ACCENTS)) return null;
  if (matchesDefault(upperAccents, OFFICE_2013_DEFAULT_ACCENTS)) return null;

  return upperAccents.map((c) => `#${c}`);
}

// ─── Internals ─────────────────────────────────────────────────────

function findFirstTheme(zip: JSZip): JSZip.JSZipObject | null {
  let found: JSZip.JSZipObject | null = null;
  // Match any theme file under ppt/theme/ — see fonts-pptx.ts's
  // findFirstTheme for the rationale. Keep these two implementations
  // in sync; both fall through here when ppt/theme/theme1.xml is
  // absent (themeOverride exports, exotic OOXML producers).
  zip.forEach((relativePath, file) => {
    if (found) return;
    if (/^ppt\/theme\/theme[^/]*\.xml$/i.test(relativePath)) {
      found = file;
    }
  });
  return found;
}

/**
 * Walk `<a:clrScheme>` → accent1..accent6 → `<a:srgbClr val="...">`.
 * Some themes use `<a:sysClr val="windowText" lastClr="000000"/>`
 * for the dk1/lt1 slots — we skip those because system colors are
 * never brand-intent. We only read srgbClr from accent* slots.
 *
 * Returns an array of 6-digit uppercase hex strings (no `#` prefix).
 */
function parseAccents(themeXml: string): string[] {
  const doc = new DOMParser().parseFromString(themeXml, "text/xml");
  const schemeEls = doc.getElementsByTagName("a:clrScheme");
  if (schemeEls.length === 0) return [];
  const scheme = schemeEls.item(0);
  if (!scheme) return [];

  const out: string[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const slotEls = scheme.getElementsByTagName(`a:accent${i}`);
    const slot = slotEls.item(0);
    if (!slot) continue;
    // Prefer srgbClr (literal hex). Some authors use sysClr inside
    // accents with a lastClr fallback — fall back to that.
    const srgb = slot.getElementsByTagName("a:srgbClr").item(0);
    if (srgb) {
      const val = srgb.getAttribute("val");
      if (val && /^[0-9A-Fa-f]{6}$/.test(val)) {
        out.push(val.toUpperCase());
        continue;
      }
    }
    const sys = slot.getElementsByTagName("a:sysClr").item(0);
    if (sys) {
      const lastClr = sys.getAttribute("lastClr");
      if (lastClr && /^[0-9A-Fa-f]{6}$/.test(lastClr)) {
        out.push(lastClr.toUpperCase());
      }
    }
  }
  return out;
}

function matchesDefault(accents: string[], defaults: string[]): boolean {
  if (accents.length !== defaults.length) return false;
  return accents.every((c, i) => c === defaults[i]);
}
