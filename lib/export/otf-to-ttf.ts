// OTF (CFF / OpenType-PS) → TTF (TrueType / glyf) conversion for PPTX font
// embedding.
//
// WHY: PowerPoint's embedded-font feature renders ONLY TrueType-outline
// (`glyf`) fonts. A `.otf` with PostScript/CFF outlines is registered in the
// OOXML `embeddedFontLst` just fine but PowerPoint silently ignores it and
// falls back to a system font (verified on an exported deck: the `.fntdata`
// payloads were `OTTO`/CFF-flavoured and didn't render). Google Fonts dodge
// this because their woff2 decompresses to `glyf`; the user's commercial `.otf`
// uploads don't, so they need converting before we EOT-wrap + splice them in.
//
// HOW: shell out to `fontforge` — the same deployment model as the LibreOffice
// (`soffice`) + poppler (`pdftoppm`) steps this app already uses. fontforge
// converts the cubic CFF outlines to quadratic `glyf` AND preserves the
// OpenType layout tables (`GSUB`/`GPOS`/`GDEF`) — which Arabic shaping REQUIRES,
// since a .pptx stores plain Unicode runs that PowerPoint re-shapes against the
// embedded font. (Pure-JS converters like fonteditor-core/opentype.js drop
// those layout tables, which would break Arabic — hence fontforge.)
//
// Best-effort: if fontforge is absent (e.g. local dev before `brew install
// fontforge`) or the conversion fails, we return null and the caller embeds the
// original bytes — no worse than today (PPT just ignores them).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// Cap the conversion — best-effort, so a stalled/oversized font must not hang
// the export route (maxDuration 60s). A real font converts in ~1–3s.
const FONTFORGE_TIMEOUT_MS = 25_000;

// True when the sfnt has PostScript/CFF outlines (no `glyf`). Detects both the
// `OTTO` sfnt signature and a `CFF ` table tag (covers fonts that lie about
// their extension). Cheap byte inspection — no parse.
export function isCffFont(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // sfnt version 'OTTO' (0x4F 54 54 4F) → OpenType with CFF outlines.
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x4f
  ) {
    return true;
  }
  // Otherwise scan the table directory for a 'CFF ' (0x43 46 46 20) tag.
  const numTables = (bytes[4] << 8) | bytes[5];
  for (let i = 0; i < numTables; i += 1) {
    const off = 12 + i * 16;
    if (off + 4 > bytes.length) break;
    if (
      bytes[off] === 0x43 &&
      bytes[off + 1] === 0x46 &&
      bytes[off + 2] === 0x46 &&
      bytes[off + 3] === 0x20
    ) {
      return true;
    }
  }
  return false;
}

// Escape a string for a fontforge `.pe` double-quoted literal (backslash first,
// then the closing quote). Used for the temp paths AND the rename strings.
function ffStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Convert CFF/OpenType-PS bytes to a TrueType (`glyf`) font via fontforge.
//
// When `renameTypeface` is given, ALSO rewrite the font's name table so its
// family + full name = that exact string. This is REQUIRED for PowerPoint
// embedding: PPT binds an embedded font to a run by matching the run's
// typeface against the font's INTERNAL name — not the OOXML `typeface=`
// attribute. The app names runs `Family Weight` (e.g. "DIN NEXT™ ARABIC Bold")
// but a commercial face often names itself per-weight ("DIN NEXT™ ARABIC
// BOLD", subfamily Regular), so without this rename the names mismatch and PPT
// falls back. The PostScript name (1st arg) must be ASCII without spaces, so it
// gets sanitised; family + full keep the exact UTF-8 string (™ included).
//
// Returns the converted bytes, or null on any failure (caller falls back).
export async function convertOtfToTtf(
  otf: Uint8Array,
  renameTypeface?: string,
): Promise<Uint8Array | null> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "otf2ttf-"));
    const inPath = join(dir, "in.otf");
    const outPath = join(dir, "out.ttf");
    await writeFile(inPath, otf);

    // Run the conversion through a `.pe` SCRIPT FILE (UTF-8) rather than a
    // command-line `-c` string so a `™` in the rename survives intact (a
    // shell/argv round-trip can mangle non-ASCII). `Generate(.ttf)` converts
    // cubic→quadratic and keeps the OpenType layout tables (Arabic shaping).
    let scriptBody = `Open("${ffStr(inPath)}")\n`;
    if (renameTypeface) {
      const psName =
        renameTypeface.replace(/[^A-Za-z0-9]/g, "").slice(0, 60) || "BrandFont";
      const fam = ffStr(renameTypeface);
      // SetFontNames sets the PostScript name + the RIBBI family (nameID 1) +
      // full name (nameID 4). But many commercial faces ALSO carry a
      // typographic family (nameID 16) + subfamily (17) — PowerPoint may match
      // on those FIRST. Overwrite 16/17 (Windows en-US, 0x409) so EVERY name
      // PPT could read = the run's typeface; subfamily collapses to Regular so
      // the family alone identifies the weight.
      scriptBody +=
        `SetFontNames("${ffStr(psName)}", "${fam}", "${fam}")\n` +
        `SetTTFName(0x409, 1, "${fam}")\n` +
        `SetTTFName(0x409, 2, "Regular")\n` +
        `SetTTFName(0x409, 4, "${fam}")\n` +
        `SetTTFName(0x409, 16, "${fam}")\n` +
        `SetTTFName(0x409, 17, "Regular")\n`;
    }
    scriptBody += `Generate("${ffStr(outPath)}")\n`;
    const scriptPath = join(dir, "convert.pe");
    await writeFile(scriptPath, scriptBody, "utf8");

    await execFileAsync("fontforge", ["-lang=ff", "-script", scriptPath], {
      timeout: FONTFORGE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const ttf = await readFile(outPath);
    if (ttf.length === 0) return null;
    return new Uint8Array(ttf);
  } catch (err) {
    console.warn("[embed-fonts] fontforge OTF→TTF conversion failed:", err);
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
