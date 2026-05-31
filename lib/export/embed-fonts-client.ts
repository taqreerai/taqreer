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

export type FontTarget = { name: string; url: string };
export type WeightKey = "regular" | "bold";
/** One converted weight, EOT bytes base64-encoded for JSON transport. */
export type ConvertedFontFile = { weight: WeightKey; eotBase64: string };
/** A font family with its converted weight files, ready to splice. */
export type ConvertedFont = { name: string; files: ConvertedFontFile[] };
export type EmbedFontStats = { attempted: number; embedded: number; failed: number };

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

function appendEmbeddedFontEntry(
  lst: Element,
  typeface: string,
  regularRid: string | null,
  boldRid: string | null,
): void {
  const doc = lst.ownerDocument!;
  const entry = doc.createElementNS(NS_P, "p:embeddedFont");
  const fontEl = doc.createElementNS(NS_P, "p:font");
  fontEl.setAttribute("typeface", typeface);
  entry.appendChild(fontEl);
  if (regularRid) {
    const reg = doc.createElementNS(NS_P, "p:regular");
    reg.setAttributeNS(NS_R, "r:id", regularRid);
    entry.appendChild(reg);
  }
  if (boldRid) {
    const b = doc.createElementNS(NS_P, "p:bold");
    b.setAttributeNS(NS_R, "r:id", boldRid);
    entry.appendChild(b);
  }
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
  for (const set of usable) {
    let regularRid: string | null = null;
    let boldRid: string | null = null;
    for (const file of set.files) {
      const fileName = `font${fileCounter}.fntdata`;
      fileCounter += 1;
      zip.file(`ppt/fonts/${fileName}`, base64ToBytes(file.eotBase64));
      const rid = nextAvailableRid(relsDoc);
      appendRelationship(relsDoc, rid, `fonts/${fileName}`);
      if (file.weight === "regular") regularRid = rid;
      else if (file.weight === "bold") boldRid = rid;
    }
    appendEmbeddedFontEntry(lst, set.name, regularRid, boldRid);
    embeddedCount += 1;
  }
  if (stats) {
    stats.embedded += embeddedCount;
    stats.failed += convertedFonts.length - embeddedCount;
  }

  zip.file("ppt/presentation.xml", serializer.serializeToString(presentationDoc));
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
