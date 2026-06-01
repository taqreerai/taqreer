// Embeds Google Fonts (heading + body, weights 400 + 700) into the PPTX so
// PowerPoint renders the deck with the EXACT font binaries we ship — no
// system-font resolution, no "all slides switch to the heaviest weight on
// edit" surprise.
//
// Why this matters: OOXML PPT only has two weight states per run (b="0" /
// b="1"). When PowerPoint edits a text box, it re-walks the system font
// registry to resolve the typeface, and on most macOS / Windows installs
// "Cairo" doesn't have a complete 400+700 family registered — so PPT
// substitutes whichever Cairo variant is actually present (often the
// heaviest, like Cairo Black). Embedded fonts bypass system resolution
// entirely: PPT renders directly from the bytes inside the .pptx.
//
// Why not use dom-to-pptx's built-in `fonts` option: the library's
// embedder hardcodes `<p:regular r:id="..."/>` and never emits
// `<p:bold>`. Bold-weight runs (`<a:rPr b="1"/>`) on an embedded family
// fall back to PPT's system resolver — exactly the bug we're fixing. We
// also need woff2 input (Google Fonts only serves woff2 to modern
// browsers); the library only supports ttf/woff/otf. So we run our own
// pass that handles both weights and decompresses woff2.
//
// Flow:
//   1. Pull fontHeading + fontBody from manifest.theme.
//   2. Fetch the Google Fonts CSS endpoint for each; parse out the woff2
//      URLs for weights 400 + 700.
//   3. Fetch each woff2, decompress to TTF with `wawoff2`, then convert
//      TTF → EOT with `fonteditor-core` (Microsoft's Embedded OpenType,
//      the format PowerPoint reads natively from .fntdata files).
//   4. Drop the EOT bytes into /ppt/fonts/fontN.fntdata.
//   5. Add a Relationship in /ppt/_rels/presentation.xml.rels.
//   6. Insert <p:embeddedFontLst> in /ppt/presentation.xml (or extend it
//      if dom-to-pptx already emitted one) and set the
//      `saveSubsetFonts` + `embedTrueTypeFonts` flags on
//      <p:presentation/> so PPT actually honours the embedded fonts.
//   7. Add `<Default Extension="fntdata" ContentType="application/x-fontdata"/>`
//      to [Content_Types].xml.
//
// Best-effort: any single font failure (CSS unreachable, woff2 missing for
// a weight, decompression error) is swallowed. The pipeline continues
// without that variant — at worst the deck falls back to system fonts for
// the missing weight, which is the same baseline behaviour we had before
// this module existed.

import type JSZipType from "jszip";
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

// Server-only module. Imported by /api/export/embed-fonts; never bundled
// into the client because `wawoff2`'s WASM bridge (woff2 → ttf
// decompression) pulls in Node's `fs`/`path` for filesystem-style WASM
// loading, which Turbopack can't satisfy in the browser bundle. Running
// server-side also avoids client-side CORS gymnastics for the Google
// Fonts CSS endpoint.

export type FontTarget = { name: string; url: string };

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const FONT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

export type EmbedFontStats = {
  attempted: number;
  embedded: number;
  failed: number;
};

type WeightKey = "regular" | "bold";

type FontFile = { weight: WeightKey; fontBytes: Uint8Array };

// ─── Step 2: Parse Google Fonts CSS for woff2 URLs per weight ────────

type FontSourceFormat = "woff2" | "truetype" | "opentype";
type FontSource = { url: string; format: FontSourceFormat };

function extractFontSourcesByWeight(
  css: string,
): Record<WeightKey, FontSource | null> {
  const result: Record<WeightKey, FontSource | null> = {
    regular: null,
    bold: null,
  };
  // Each @font-face block; split on the literal keeps everything after as
  // the block contents up to the next block / EOF.
  const blocks = css.split("@font-face");
  for (const block of blocks.slice(1)) {
    const weightMatch = /font-weight:\s*(\d+)/.exec(block);
    if (!weightMatch) continue;
    const weight = Number(weightMatch[1]);
    let key: WeightKey | null = null;
    if (weight === 400) key = "regular";
    else if (weight === 700) key = "bold";
    if (!key || result[key]) continue;
    // Google Fonts' CSS endpoint serves different `src:` formats based
    // on the request User-Agent — modern browsers get woff2, older UAs
    // (curl, Node fetch) get truetype. The route runs server-side, so we
    // accept BOTH and skip the wawoff2 decompress step when we already
    // have raw TTF bytes. The regex captures the URL + the matched
    // format keyword.
    const urlMatch =
      /src:\s*[^;]*?url\(\s*([^)]+?)\s*\)\s*format\(['"](woff2|truetype|opentype)['"]\)/.exec(
        block,
      );
    if (urlMatch) {
      result[key] = {
        url: urlMatch[1].replace(/['"]/g, ""),
        format: urlMatch[2] as FontSourceFormat,
      };
    }
  }
  return result;
}

// ─── Step 3: Fetch the font binary, return EOT bytes ready for .fntdata ──

async function fetchFontAsEot(src: FontSource): Promise<Uint8Array | null> {
  try {
    const res = await fetch(src.url);
    if (!res.ok) return null;
    const rawBytes = new Uint8Array(await res.arrayBuffer());

    // woff2 needs a Brotli-based decompress step before TTF can be
    // produced; TTF/OTF responses skip that hop entirely.
    let ttfBytes: Uint8Array<ArrayBufferLike> = rawBytes;
    if (src.format === "woff2") {
      const wawoff2 = await import("wawoff2");
      const decompress = wawoff2.decompress ?? wawoff2.default?.decompress;
      if (typeof decompress !== "function") return null;
      const ttf = await decompress(rawBytes);
      ttfBytes = ttf instanceof Uint8Array ? ttf : new Uint8Array(ttf);
    }

    // Convert TTF → EOT. PowerPoint specifically expects EOT (Microsoft
    // Embedded OpenType) bytes inside .fntdata entries; raw TTF lands
    // in the zip but PPT silently doesn't recognise it as an embedded
    // font and falls back to system-font resolution (the "regular font
    // + Chinese on edit" failure mode).
    //
    // We call fonteditor-core's `ttf2eot` directly rather than the
    // `Font.create() → font.write({ type: 'eot' })` higher-level API.
    // The latter parses the TTF into an internal representation that
    // ONLY models the 10 "core" tables (cmap, glyf, head, hhea, hmtx,
    // loca, maxp, name, OS/2, post) — when it re-serialises, OpenType
    // layout tables (GSUB / GPOS / GDEF / STAT / gasp / prep) are
    // silently DROPPED. Arabic shaping then can't fire — the "detached
    // letters" bug. ttf2eot, by contrast, reads the TTF's OS/2 + name
    // tables to build the EOT header and then writes the TTF buffer
    // VERBATIM at the tail (see node_modules/fonteditor-core/lib/ttf/
    // ttf2eot.js — final line: `eotWriter.writeBytes(ttfBuffer, ...)`),
    // so every original table survives.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonteditor: any = await import("fonteditor-core");
    const ttf2eot = fonteditor.ttf2eot ?? fonteditor.default?.ttf2eot;
    if (typeof ttf2eot !== "function") return null;
    const eotOut = ttf2eot(
      ttfBytes.buffer.slice(
        ttfBytes.byteOffset,
        ttfBytes.byteOffset + ttfBytes.byteLength,
      ),
    );
    if (eotOut instanceof ArrayBuffer) return new Uint8Array(eotOut);
    if (eotOut instanceof Uint8Array) return eotOut;
    if (eotOut?.buffer instanceof ArrayBuffer) {
      return new Uint8Array(
        eotOut.buffer.slice(
          eotOut.byteOffset,
          eotOut.byteOffset + eotOut.byteLength,
        ),
      );
    }
    return null;
  } catch (err) {
    console.warn(`[embed-fonts] font fetch/convert failed for ${src.url}:`, err);
    return null;
  }
}

// ─── Build the per-font TTF set ─────────────────────────────────────

async function fetchFontFiles(cssUrl: string): Promise<FontFile[]> {
  let css: string;
  try {
    const res = await fetch(cssUrl);
    if (!res.ok) return [];
    css = await res.text();
  } catch {
    return [];
  }
  const sources = extractFontSourcesByWeight(css);
  const files: FontFile[] = [];
  // Run the two weights in parallel — independent fetches.
  const results = await Promise.all(
    (Object.keys(sources) as WeightKey[]).map(async (weight) => {
      const src = sources[weight];
      if (!src) return null;
      const eot = await fetchFontAsEot(src);
      return eot ? { weight, fontBytes: eot } : null;
    }),
  );
  for (const r of results) {
    if (r) files.push(r);
  }
  return files;
}

// ─── XML patching helpers ───────────────────────────────────────────

function nextAvailableRid(relsDoc: XmlDocument): string {
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

function ensureContentTypeForFntdata(ctDoc: XmlDocument): boolean {
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

function findOrCreateEmbeddedFontLst(presentationDoc: XmlDocument): XmlElement | null {
  const root = presentationDoc.documentElement;
  if (!root) return null;
  const existing = presentationDoc.getElementsByTagNameNS(NS_P, "embeddedFontLst");
  if (existing.length > 0) return existing[0];
  const lst = presentationDoc.createElementNS(NS_P, "p:embeddedFontLst");
  // OOXML (ECMA-376) requires a strict child order under <p:presentation>:
  //   sldMasterIdLst, notesMasterIdLst, handoutMasterIdLst, sldIdLst,
  //   sldSz, notesSz, embeddedFontLst, custShowLst, photoAlbum,
  //   custDataLst, kinsoku, defaultTextStyle, modifyVerifier, extLst
  //
  // PowerPoint's parser is strict: a misordered <p:embeddedFontLst>
  // (e.g. appended at the end, AFTER <p:defaultTextStyle>) is silently
  // IGNORED — the .fntdata files end up in the zip but PPT never looks
  // them up, so it falls back to system-font resolution. That's the
  // "fonts in zip, didn't render on the other laptop" bug.
  //
  // Insert BEFORE the first of any later siblings that ARE present.
  // Walk the spec-defined "after" list in order so we land in the right
  // slot regardless of which optional elements dom-to-pptx wrote.
  const AFTER_EMBED_FONT_LIST = [
    "custShowLst",
    "photoAlbum",
    "custDataLst",
    "kinsoku",
    "defaultTextStyle",
    "modifyVerifier",
    "extLst",
  ];
  let anchor: XmlElement | null = null;
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
  lst: XmlElement,
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
  relsDoc: XmlDocument,
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

// ─── Main entry: patch the PPTX blob with embedded fonts ────────────

export async function embedFontsInPptx(
  blob: Blob,
  targets: FontTarget[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  JSZip: any,
  stats?: EmbedFontStats,
): Promise<Blob> {
  if (stats) stats.attempted += targets.length;
  if (targets.length === 0) return blob;

  // Fetch all TTF binaries in parallel BEFORE touching the zip. If every
  // font fails (e.g. offline), we short-circuit and skip the rewrite.
  const fontSets = await Promise.all(
    targets.map(async (t) => ({ target: t, files: await fetchFontFiles(t.url) })),
  );
  const usable = fontSets.filter((s) => s.files.length > 0);
  if (usable.length === 0) {
    if (stats) stats.failed += targets.length;
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
    // Unexpected zip layout — bail without modifying anything.
    if (stats) stats.failed += targets.length;
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
  // Required flags on <p:presentation/> for PowerPoint to actually USE
  // the embedded fonts when editing (not just at first paint). Without
  // these, PPT treats the embedded set as advisory and still does a
  // system-font lookup — defeating the whole point. Matches what
  // dom-to-pptx's own embedder writes.
  const presentationRoot = presentationDoc.documentElement;
  if (presentationRoot) {
    presentationRoot.setAttribute("saveSubsetFonts", "true");
    presentationRoot.setAttribute("embedTrueTypeFonts", "true");
  }
  const lst = findOrCreateEmbeddedFontLst(presentationDoc);
  if (!lst) {
    if (stats) stats.failed += targets.length;
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
      zip.file(`ppt/fonts/${fileName}`, file.fontBytes);
      const rid = nextAvailableRid(relsDoc);
      appendRelationship(relsDoc, rid, `fonts/${fileName}`);
      if (file.weight === "regular") regularRid = rid;
      else if (file.weight === "bold") boldRid = rid;
    }
    appendEmbeddedFontEntry(lst, set.target.name, regularRid, boldRid);
    embeddedCount += 1;
  }
  if (stats) {
    stats.embedded += embeddedCount;
    stats.failed += targets.length - embeddedCount;
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
