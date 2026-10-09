// Client-side half of the PPTX font embed (see embed-fonts.ts for the
// server-side conversion half).
//
// Why split: the conversion (Google-Fonts woff2 → TTF → EOT) needs Node-only
// deps (`wawoff2`'s WASM `fs` bridge), so it must run server-side. But the
// previous design also did the ZIP SPLICE server-side, which forced the
// client to upload the ENTIRE .pptx to the route — and an images-mode deck
// (raster PNGs + rasterised gradient SVGs) blows past Next's 10 MB body cap
// locally and Vercel's ~4.5 MB cap in prod, so the route 400s and the deck
// ships with NO embedded fonts. PowerPoint then resolves "Cairo" against the
// system registry and, on edit, swaps bold runs to the heaviest installed
// Cairo (the "bold → ExtraBlack after editing" bug).
//
// The fix: the client sends only the font URLs (a few hundred bytes), the
// server returns just the converted EOT bytes (~0.5 MB), and THIS module
// splices them into the pptx zip the browser already holds — the .pptx never
// crosses the network, so no body limit applies regardless of image count.
//
// Uses browser-native DOMParser / XMLSerializer + JSZip only (this module
// only runs client-side, same as bidi-postprocess.ts), so it bundles cleanly
// for the browser with no @xmldom dependency. The shared transport types live
// here; the server conversion module imports them.

import type JSZipType from "jszip";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const FONT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

// A font to convert + embed. Two shapes:
//   • Google CSS endpoint (`url`) → server fetches the css2 response and
//     extracts one woff2 per weight (the multi-weight path).
//   • Uploaded brand font (`faces`) → one signed URL per uploaded WEIGHT file
//     (TTF/OTF/WOFF2) in the private brand-assets bucket. The server converts
//     each and registers all 9 standard weight typefaces against the nearest
//     uploaded face, so every weighted run resolves to a real uploaded file.
export type FontTarget =
  | { name: string; url: string }
  | { name: string; faces: { weight: number; src: string }[] };
/** One converted weight, EOT bytes base64-encoded for JSON transport. The
 * weight is the numeric CSS font-weight (100–900) of that @font-face. */
export type ConvertedFontFile = { weight: number; eotBase64: string };
/** A font family with its converted weight files, ready to splice. `alias`
 * is set when the server renamed the files (see embedAlias): the splice then
 * registers the alias and renames the deck's runs to it. */
export type ConvertedFont = { name: string; alias?: string; files: ConvertedFontFile[] };
export type EmbedFontStats = { attempted: number; embedded: number; failed: number };

// CSS numeric weight → the typeface-NAME suffix PowerPoint uses for that
// static instance (confirmed against PowerPoint's own .pptx output: it stores
// each weight as e.g. `typeface="Cairo SemiBold"`, never "Cairo" + a numeric
// weight). 400 = the base family name (no suffix). This MUST stay byte-for-
// byte identical to the copy in the dom-to-pptx patch (getTextStyle) so a run
// and its embedded entry resolve to the same typeface string.
const WEIGHT_SUFFIX: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** Snap an arbitrary CSS weight to the nearest standard 100-step (clamped to
 *  100–900). "bold"/"normal" arrive pre-resolved to 700/400 from the DOM. */
export function normalizeWeight(weight: number | string): number {
  const n =
    typeof weight === "number" ? weight : parseInt(String(weight), 10) || 400;
  return Math.min(900, Math.max(100, Math.round(n / 100) * 100));
}

/** Named typeface for a (base family, weight) pair — e.g. ("Cairo", 600) →
 *  "Cairo SemiBold"; ("Cairo", 400) → "Cairo". The single source of truth the
 *  splicer uses; dom-to-pptx mirrors this exact mapping for the runs. */
export function weightedTypeface(base: string, weight: number | string): string {
  const suffix = WEIGHT_SUFFIX[normalizeWeight(weight)] ?? "";
  return suffix ? `${base} ${suffix}` : base;
}

/** Private embed name for a Google family: PowerPoint prefers an INSTALLED
 *  font over the embedded copy when the names match, so an incomplete local
 *  install (e.g. the Arabic-only Noto release of "Noto Sans Arabic", no Latin
 *  letters) used to break the deck's text. Single source of truth for the
 *  server rename (embed-fonts.ts) and the run rename below. */
export function embedAlias(name: string): string {
  return `${name} TQ`;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Rename every `typeface="…"` that names one of the aliased families (any of
// the 9 weight names) across the package's XML parts: slides, layouts,
// masters, theme, notes. dom-to-pptx writes the real family name; the
// embedded entries carry the alias, so the runs must follow.
async function renameTypefaces(zip: JSZipType, fonts: ConvertedFont[]): Promise<void> {
  const map = new Map<string, string>();
  for (const f of fonts) {
    if (!f.alias) continue;
    for (const w of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      map.set(
        escapeXmlAttr(weightedTypeface(f.name, w)),
        escapeXmlAttr(weightedTypeface(f.alias, w)),
      );
    }
  }
  if (map.size === 0) return;
  const parts = Object.keys(zip.files).filter(
    (p) => p.startsWith("ppt/") && p.endsWith(".xml"),
  );
  for (const path of parts) {
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async("string");
    let changed = false;
    const next = xml.replace(/typeface="([^"]*)"/g, (whole, value: string) => {
      const alias = map.get(value);
      if (!alias) return whole;
      changed = true;
      return `typeface="${alias}"`;
    });
    if (changed) zip.file(path, next);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── XML patching helpers (identical to the old server-side splice) ──

function nextAvailableRid(relsDoc: Document): string {
  const rels = relsDoc.getElementsByTagName("Relationship");
  let max = 0;
  for (let i = 0; i < rels.length; i += 1) {
    const id = rels[i].getAttribute("Id") ?? "";
    const m = /^rId(\d+)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `rId${max + 1}`;
}

function ensureContentTypeForFntdata(ctDoc: Document): boolean {
  const root = ctDoc.documentElement;
  if (!root) return false;
  const defaults = ctDoc.getElementsByTagName("Default");
  for (let i = 0; i < defaults.length; i += 1) {
    if (defaults[i].getAttribute("Extension") === "fntdata") return false;
  }
  const node = ctDoc.createElementNS(NS_CT, "Default");
  node.setAttribute("Extension", "fntdata");
  node.setAttribute("ContentType", "application/x-fontdata");
  root.appendChild(node);
  return true;
}

function findOrCreateEmbeddedFontLst(
  presentationDoc: Document,
): Element | null {
  const root = presentationDoc.documentElement;
  if (!root) return null;
  const existing = presentationDoc.getElementsByTagNameNS(NS_P, "embeddedFontLst");
  if (existing.length > 0) return existing[0];
  const lst = presentationDoc.createElementNS(NS_P, "p:embeddedFontLst");
  // OOXML (ECMA-376) requires a strict child order under <p:presentation>.
  // A misordered <p:embeddedFontLst> (e.g. appended after
  // <p:defaultTextStyle>) is silently IGNORED by PowerPoint — the .fntdata
  // files end up in the zip but PPT never looks them up. Insert BEFORE the
  // first later sibling that's actually present.
  const AFTER_EMBED_FONT_LIST = [
    "custShowLst",
    "photoAlbum",
    "custDataLst",
    "kinsoku",
    "defaultTextStyle",
    "modifyVerifier",
    "extLst",
  ];
  let anchor: Element | null = null;
  for (const localName of AFTER_EMBED_FONT_LIST) {
    const hits = presentationDoc.getElementsByTagNameNS(NS_P, localName);
    if (hits.length > 0) {
      anchor = hits[0];
      break;
    }
  }
  if (anchor) {
    root.insertBefore(lst, anchor);
  } else {
    root.appendChild(lst);
  }
  return lst;
}

// Each weight is embedded as its OWN named typeface ("Cairo SemiBold", …) with
// the EOT in the <p:regular> slot — NEVER the <p:bold> slot. PowerPoint models
// multi-weight families exactly this way, and a bold slot would re-introduce
// the `b="1"` escalation-on-edit bug (a bold-flagged run resolves to the
// heaviest member of the RIBBI group). One regular slot per weight = stable.
function appendEmbeddedFontEntry(
  lst: Element,
  typeface: string,
  regularRid: string,
): void {
  const doc = lst.ownerDocument!;
  const entry = doc.createElementNS(NS_P, "p:embeddedFont");
  const fontEl = doc.createElementNS(NS_P, "p:font");
  fontEl.setAttribute("typeface", typeface);
  entry.appendChild(fontEl);
  const reg = doc.createElementNS(NS_P, "p:regular");
  reg.setAttributeNS(NS_R, "r:id", regularRid);
  entry.appendChild(reg);
  lst.appendChild(entry);
}

function appendRelationship(
  relsDoc: Document,
  rid: string,
  target: string,
): void {
  const root = relsDoc.documentElement;
  if (!root) return;
  const rel = relsDoc.createElementNS(NS_PKG_REL, "Relationship");
  rel.setAttribute("Id", rid);
  rel.setAttribute("Type", FONT_REL_TYPE);
  rel.setAttribute("Target", target);
  root.appendChild(rel);
}

/**
 * Splice already-converted EOT fonts into the pptx zip, client-side.
 * `convertedFonts` comes from POST /api/export/embed-fonts (server-side
 * conversion). Mirrors the old `embedFontsInPptx` splice exactly, minus the
 * network round-trip of the whole deck.
 */
export async function embedConvertedFontsInPptx(
  blob: Blob,
  convertedFonts: ConvertedFont[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  JSZip: any,
  stats?: EmbedFontStats,
): Promise<Blob> {
  if (stats) stats.attempted += convertedFonts.length;
  const usable = convertedFonts.filter((f) => f.files.length > 0);
  if (usable.length === 0) {
    if (stats) stats.failed += convertedFonts.length;
    return blob;
  }

  const buf = await blob.arrayBuffer();
  const zip = (await JSZip.loadAsync(buf)) as JSZipType;
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const presentationXmlEntry = zip.file("ppt/presentation.xml");
  const relsXmlEntry = zip.file("ppt/_rels/presentation.xml.rels");
  const contentTypesEntry = zip.file("[Content_Types].xml");
  if (!presentationXmlEntry || !relsXmlEntry || !contentTypesEntry) {
    if (stats) stats.failed += convertedFonts.length;
    return blob;
  }

  const presentationDoc = parser.parseFromString(
    await presentationXmlEntry.async("string"),
    "application/xml",
  );
  const relsDoc = parser.parseFromString(
    await relsXmlEntry.async("string"),
    "application/xml",
  );
  const contentTypesDoc = parser.parseFromString(
    await contentTypesEntry.async("string"),
    "application/xml",
  );

  ensureContentTypeForFntdata(contentTypesDoc);
  // Flags PowerPoint needs to actually USE the embedded fonts on edit (not
  // just first paint). Without them PPT treats the set as advisory and falls
  // back to system resolution — the bug we're fixing.
  const presentationRoot = presentationDoc.documentElement;
  if (presentationRoot) {
    presentationRoot.setAttribute("saveSubsetFonts", "true");
    presentationRoot.setAttribute("embedTrueTypeFonts", "true");
  }
  const lst = findOrCreateEmbeddedFontLst(presentationDoc);
  if (!lst) {
    if (stats) stats.failed += convertedFonts.length;
    return blob;
  }

  let fileCounter = 1;
  let embeddedCount = 0;
  // Each (family, weight) becomes its OWN named <p:embeddedFont> typeface,
  // matching the run typefaces dom-to-pptx emits ("Cairo SemiBold", …). Dedup
  // by typeface so heading + body sharing a weight (e.g. both "Cairo" at 400)
  // don't emit two entries for the same name.
  const seenTypefaces = new Set<string>();
  // Store one .fntdata per DISTINCT byte payload. An uploaded single-face font
  // is registered under all 9 weight names but is the SAME bytes — without this
  // the deck would carry 9 identical copies of the file. Google weights have
  // distinct bytes, so they each still get their own file. Each typeface keeps
  // its OWN relationship (rid) pointing at the shared target.
  const fileNameByBytes = new Map<string, string>();
  for (const set of usable) {
    for (const file of set.files) {
      const typeface = weightedTypeface(set.alias ?? set.name, file.weight);
      if (seenTypefaces.has(typeface)) continue;
      seenTypefaces.add(typeface);
      let fileName = fileNameByBytes.get(file.eotBase64);
      if (!fileName) {
        fileName = `font${fileCounter}.fntdata`;
        fileCounter += 1;
        zip.file(`ppt/fonts/${fileName}`, base64ToBytes(file.eotBase64));
        fileNameByBytes.set(file.eotBase64, fileName);
      }
      const rid = nextAvailableRid(relsDoc);
      appendRelationship(relsDoc, rid, `fonts/${fileName}`);
      appendEmbeddedFontEntry(lst, typeface, rid);
      embeddedCount += 1;
    }
  }
  if (stats) stats.embedded += embeddedCount;

  zip.file("ppt/presentation.xml", serializer.serializeToString(presentationDoc));
  await renameTypefaces(zip, usable);
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    serializer.serializeToString(relsDoc),
  );
  zip.file("[Content_Types].xml", serializer.serializeToString(contentTypesDoc));

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
