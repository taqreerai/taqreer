// Enhance phase 1, step 2 (docs/enhance-visuals-plan.md): find every picture
// (and every chart / table / SmartArt frame) placed on each slide of a PPTX,
// in PRESENTATION order, with its box as fractions of the slide.
//
// Exact and free: positions come straight from the slide XML (EMU), so no
// model is involved. Pictures inherited from the slide LAYOUT / MASTER are not
// on the slide itself and never appear here, which drops most template art
// for free. What remains is classified by classifyPptxPictures:
//   content    a real picture of the deck (carried over, counts for the
//              per-file AI images rule)
//   small      under SMALL_AREA of the slide (icons, logos, badges): carried
//              over but NOT a content photo
//   background full-bleed AND reused on many slides (a template backdrop)
//   repeated   the same media file at the same place on many slides (frame
//              art, a corner logo strip)
//
// Picture bytes are the ORIGINAL embedded media (full resolution, no slide
// background baked in); the source crop (a:srcRect) is kept so the caller can
// cut exactly what the slide shows. Vector formats (EMF / WMF) are flagged so
// the caller can fall back to a crop of the rendered page.

import JSZip from "jszip";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { resolveSlideOrder } from "@/lib/extract/text-pptx";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

// Below this share of the slide area a picture is an icon / logo / badge.
const SMALL_AREA = 0.03;
// At or above this share it covers the slide (a backdrop candidate).
const FULL_BLEED_AREA = 0.85;
// "Many slides": a media file on at least this share of slides (and at least
// MIN_REPEAT_SLIDES of them) is template art, not content.
const REPEAT_SHARE = 0.5;
const MIN_REPEAT_SLIDES = 3;

export type Box = { x: number; y: number; w: number; h: number };

export type PptxPicture = {
  slideIndex: number; // presentation order, 0-based
  shapeId: string;
  name: string;
  altText: string | null;
  box: Box; // fractions of the slide, may extend past 0..1 when bleeding off
  mediaPath: string; // zip path, e.g. "ppt/media/image3.jpeg"
  format: "raster" | "vector" | "unknown";
  // a:srcRect: fraction trimmed from each side of the media (0..1)
  srcRect: { l: number; t: number; r: number; b: number } | null;
  rotationDeg: number;
  flipH: boolean;
  flipV: boolean;
  // Picture used as a shape's fill (p:sp with a:blipFill) rather than p:pic
  asShapeFill: boolean;
};

export type PptxTableCell = { text: string; colSpan: number; rowSpan: number };

export type PptxTable = {
  // Visible cells only: continuation cells of a merge (hMerge / vMerge) are
  // dropped, the anchor cell carries colSpan / rowSpan.
  rows: PptxTableCell[][];
  headerRow: boolean; // a:tblPr firstRow="1"
  columns: number;
};

export type PptxFrame = {
  slideIndex: number;
  kind: "chart" | "table" | "diagram" | "other";
  box: Box;
  // chart: the chart part path (ppt/charts/chartN.xml) when resolvable
  partPath: string | null;
  // table: the exact cells, straight from a:tbl
  table?: PptxTable;
};

// Exact text of a table cell: runs joined, paragraphs on their own line.
function cellText(tc: XmlElement): string {
  const txBody = child(tc, NS_A, "txBody");
  if (!txBody) return "";
  return children(txBody)
    .filter((p) => p.namespaceURI === NS_A && p.localName === "p")
    .map((p) => {
      let out = "";
      const walk = (el: XmlElement) => {
        for (const c of children(el)) {
          if (c.namespaceURI === NS_A && c.localName === "t") out += c.textContent ?? "";
          else if (c.namespaceURI === NS_A && c.localName === "br") out += "\n";
          else walk(c);
        }
      };
      walk(p);
      return out;
    })
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function readTable(graphicData: XmlElement): PptxTable | undefined {
  const tbl = child(graphicData, NS_A, "tbl");
  if (!tbl) return undefined;
  const columns = children(child(tbl, NS_A, "tblGrid") ?? tbl).filter((c) => c.localName === "gridCol").length;
  const rows: PptxTableCell[][] = [];
  for (const tr of children(tbl).filter((c) => c.namespaceURI === NS_A && c.localName === "tr")) {
    const row: PptxTableCell[] = [];
    for (const tc of children(tr).filter((c) => c.namespaceURI === NS_A && c.localName === "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      row.push({
        text: cellText(tc),
        colSpan: Math.max(1, num(tc.getAttribute("gridSpan"), 1)),
        rowSpan: Math.max(1, num(tc.getAttribute("rowSpan"), 1)),
      });
    }
    rows.push(row);
  }
  if (rows.length === 0) return undefined;
  return { rows, headerRow: child(tbl, NS_A, "tblPr")?.getAttribute("firstRow") === "1", columns: columns || Math.max(...rows.map((r) => r.reduce((n, c) => n + c.colSpan, 0))) };
}

export type PptxVisuals = {
  slideCount: number;
  slideSize: { cx: number; cy: number };
  pictures: PptxPicture[];
  frames: PptxFrame[];
};

export type PictureClass = "content" | "small" | "background" | "repeated";

type Xfrm = { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean };
// Maps a child's EMU coordinates into slide EMU (group transforms compose).
type Mapper = (x: number, y: number, cx: number, cy: number) => { x: number; y: number; cx: number; cy: number };
const IDENTITY: Mapper = (x, y, cx, cy) => ({ x, y, cx, cy });

const VECTOR_EXT = new Set(["emf", "wmf", "svg"]);
const RASTER_EXT = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp"]);

function children(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as unknown as XmlElement);
  return out;
}
function child(el: XmlElement | null | undefined, ns: string, local: string): XmlElement | null {
  if (!el) return null;
  return children(el).find((c) => c.namespaceURI === ns && c.localName === local) ?? null;
}
function deep(el: XmlElement, ns: string, local: string): XmlElement | null {
  const list = el.getElementsByTagNameNS(ns, local);
  return list.length ? (list[0] as unknown as XmlElement) : null;
}
const num = (v: string | null | undefined, d = 0) => (v == null || v === "" ? d : Number(v));

function readXfrm(xfrm: XmlElement | null): Xfrm | null {
  const off = child(xfrm, NS_A, "off");
  const ext = child(xfrm, NS_A, "ext");
  if (!xfrm || !off || !ext) return null;
  return {
    x: num(off.getAttribute("x")),
    y: num(off.getAttribute("y")),
    cx: num(ext.getAttribute("cx")),
    cy: num(ext.getAttribute("cy")),
    rot: num(xfrm.getAttribute("rot")) / 60000,
    flipH: xfrm.getAttribute("flipH") === "1",
    flipV: xfrm.getAttribute("flipV") === "1",
  };
}

function parseRels(xml: string): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const el = m[0];
    const id = el.match(/\bId="([^"]+)"/)?.[1];
    const target = el.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) map.set(id, { target, external: /\bTargetMode="External"/.test(el) });
  }
  return map;
}

// "../media/image1.png" relative to ppt/slides/ -> "ppt/media/image1.png"
function resolvePart(fromDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// By content first (PowerPoint can leave real images named `imageN.tmp`), then
// by extension.
function formatOf(path: string, head: Uint8Array): PptxPicture["format"] {
  const b = head;
  const is = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (is(0x89, 0x50, 0x4e, 0x47) || is(0xff, 0xd8, 0xff) || is(0x47, 0x49, 0x46, 0x38) ||
      is(0x42, 0x4d) || is(0x49, 0x49, 0x2a, 0x00) || is(0x4d, 0x4d, 0x00, 0x2a) ||
      (is(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)) {
    return "raster";
  }
  if (is(0x01, 0x00, 0x00, 0x00) || is(0xd7, 0xcd, 0xc6, 0x9a)) return "vector"; // EMF / WMF
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (RASTER_EXT.has(ext)) return "raster";
  if (VECTOR_EXT.has(ext)) return "vector";
  return "unknown";
}

// Placeholder geometry (a picture dropped into a layout's picture placeholder
// carries no a:xfrm of its own): look the matching placeholder up in the
// slide's layout, then in that layout's master, the way PowerPoint does.
type PhKey = { idx: string | null; type: string | null };
function phKeyOf(nvPr: XmlElement | null): PhKey | null {
  const ph = child(nvPr, NS_P, "ph");
  if (!ph) return null;
  return { idx: ph.getAttribute("idx") || null, type: ph.getAttribute("type") || null };
}
function findPhXfrm(doc: XmlElement, key: PhKey): Xfrm | null {
  const all = doc.getElementsByTagNameNS(NS_P, "ph");
  let byType: Xfrm | null = null;
  for (let i = 0; i < all.length; i++) {
    const ph = all[i] as unknown as XmlElement;
    const shape = ph.parentNode?.parentNode?.parentNode as unknown as XmlElement | null; // ph < nvPr < nv*Pr < shape
    if (!shape) continue;
    const spPr = child(shape, NS_P, "spPr") ?? child(shape, NS_P, "grpSpPr");
    const x = readXfrm(child(spPr, NS_A, "xfrm")) ?? readXfrm(child(shape, NS_P, "xfrm"));
    if (!x) continue;
    if (key.idx != null && ph.getAttribute("idx") === key.idx) return x;
    if (key.type != null && ph.getAttribute("type") === key.type && !byType) byType = x;
  }
  return byType;
}
const relsPathOf = (path: string) => {
  const dir = path.slice(0, path.lastIndexOf("/"));
  return `${dir}/_rels/${path.slice(dir.length + 1)}.rels`;
};
// The part a relationship of the given type points at (slideLayout, slideMaster).
function targetOfType(relsXml: string, fromDir: string, typeSuffix: string): string | null {
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    if (!m[0].includes(`/${typeSuffix}"`)) continue;
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (target) return resolvePart(fromDir, target);
  }
  return null;
}
// Layout then master root of a slide (for placeholder geometry), cached.
async function placeholderChain(zip: JSZip, slideRelsXml: string, slideDir: string, cache: Map<string, XmlElement | null>): Promise<XmlElement[]> {
  const load = async (path: string | null): Promise<XmlElement | null> => {
    if (!path) return null;
    if (!cache.has(path)) {
      const xml = await zip.files[path]?.async("string");
      cache.set(path, xml ? (new DOMParser().parseFromString(xml, "text/xml").documentElement as unknown as XmlElement) : null);
    }
    return cache.get(path) ?? null;
  };
  const layoutPath = targetOfType(slideRelsXml, slideDir, "slideLayout");
  const layout = await load(layoutPath);
  let master: XmlElement | null = null;
  if (layoutPath) {
    const layoutRels = (await zip.files[relsPathOf(layoutPath)]?.async("string")) ?? "";
    master = await load(targetOfType(layoutRels, layoutPath.slice(0, layoutPath.lastIndexOf("/")), "slideMaster"));
  }
  return [layout, master].filter((d): d is XmlElement => d !== null);
}

function readSrcRect(blipFill: XmlElement | null): PptxPicture["srcRect"] {
  const r = child(blipFill, NS_A, "srcRect");
  if (!r) return null;
  // Units: 1/1000 of a percent. Negative values pad; clamp to trimming only.
  const f = (k: string) => Math.max(0, num(r.getAttribute(k)) / 100000);
  const rect = { l: f("l"), t: f("t"), r: f("r"), b: f("b") };
  return rect.l || rect.t || rect.r || rect.b ? rect : null;
}

/** Parse a PPTX buffer into per-slide pictures + chart / table frames. */
export async function extractPptxVisuals(buffer: Buffer): Promise<PptxVisuals> {
  const zip = await JSZip.loadAsync(buffer);
  const presXml = await zip.files["ppt/presentation.xml"]?.async("string");
  const sz = presXml?.match(/<p:sldSz\b[^>]*>/)?.[0] ?? "";
  const slideSize = {
    cx: num(sz.match(/\bcx="(\d+)"/)?.[1], 12192000),
    cy: num(sz.match(/\bcy="(\d+)"/)?.[1], 6858000),
  };
  const order = await resolveSlideOrder(zip);
  const pictures: PptxPicture[] = [];
  const frames: PptxFrame[] = [];
  const phCache = new Map<string, XmlElement | null>();

  for (let slideIndex = 0; slideIndex < order.length; slideIndex++) {
    const slidePath = order[slideIndex];
    const xml = await zip.files[slidePath]?.async("string");
    if (!xml) continue;
    const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
    const relsXml = (await zip.files[relsPathOf(slidePath)]?.async("string")) ?? "";
    const rels = parseRels(relsXml);
    const chain = await placeholderChain(zip, relsXml, dir, phCache);
    const xfrmOrPlaceholder = (own: Xfrm | null, nvPr: XmlElement | null): Xfrm | null => {
      if (own) return own;
      const key = phKeyOf(nvPr);
      if (!key) return null;
      for (const part of chain) {
        const x = findPhXfrm(part, key);
        if (x) return x;
      }
      return null;
    };
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const spTree = deep(doc.documentElement as unknown as XmlElement, NS_P, "spTree");
    if (!spTree) continue;

    const toBox = (e: { x: number; y: number; cx: number; cy: number }): Box => ({
      x: e.x / slideSize.cx,
      y: e.y / slideSize.cy,
      w: e.cx / slideSize.cx,
      h: e.cy / slideSize.cy,
    });

    const visit = (el: XmlElement, map: Mapper) => {
      for (const c of children(el)) {
        if (c.namespaceURI === NS_MC && c.localName === "AlternateContent") {
          // Prefer the first Choice; Fallback duplicates it for old readers.
          const choice = child(c, NS_MC, "Choice") ?? child(c, NS_MC, "Fallback");
          if (choice) visit(choice, map);
          continue;
        }
        if (c.namespaceURI !== NS_P) continue;
        const nv = child(c, NS_P, c.localName === "grpSp" ? "nvGrpSpPr" : c.localName === "graphicFrame" ? "nvGraphicFramePr" : c.localName === "pic" ? "nvPicPr" : "nvSpPr");
        const cNvPr = nv ? child(nv, NS_P, "cNvPr") : null;
        if (cNvPr?.getAttribute("hidden") === "1") continue;

        if (c.localName === "grpSp") {
          const gx = readXfrm(child(child(c, NS_P, "grpSpPr"), NS_A, "xfrm"));
          const chOff = child(child(child(c, NS_P, "grpSpPr"), NS_A, "xfrm"), NS_A, "chOff");
          const chExt = child(child(child(c, NS_P, "grpSpPr"), NS_A, "xfrm"), NS_A, "chExt");
          let inner = map;
          if (gx && chOff && chExt) {
            const cox = num(chOff.getAttribute("x")), coy = num(chOff.getAttribute("y"));
            const sx = num(chExt.getAttribute("cx")) ? gx.cx / num(chExt.getAttribute("cx")) : 1;
            const sy = num(chExt.getAttribute("cy")) ? gx.cy / num(chExt.getAttribute("cy")) : 1;
            inner = (x, y, cx, cy) => map(gx.x + (x - cox) * sx, gx.y + (y - coy) * sy, cx * sx, cy * sy);
          }
          visit(c, inner);
          continue;
        }

        if (c.localName === "pic" || c.localName === "sp") {
          const spPr = child(c, NS_P, "spPr");
          const blipFill = c.localName === "pic" ? child(c, NS_P, "blipFill") : child(spPr, NS_A, "blipFill");
          const blip = child(blipFill, NS_A, "blip");
          const rid = blip?.getAttributeNS(NS_R, "embed");
          const x = xfrmOrPlaceholder(readXfrm(child(spPr, NS_A, "xfrm")), nv ? child(nv, NS_P, "nvPr") : null);
          if (!blip || !rid || !x) continue;
          const rel = rels.get(rid);
          if (!rel || rel.external) continue;
          const mediaPath = resolvePart(dir, rel.target);
          if (!zip.files[mediaPath]) continue;
          pictures.push({
            slideIndex,
            shapeId: cNvPr?.getAttribute("id") ?? "",
            name: cNvPr?.getAttribute("name") ?? "",
            altText: cNvPr?.getAttribute("descr") || null,
            box: toBox(map(x.x, x.y, x.cx, x.cy)),
            mediaPath,
            format: "unknown", // resolved from the bytes after the walk
            srcRect: readSrcRect(blipFill),
            rotationDeg: x.rot,
            flipH: x.flipH,
            flipV: x.flipV,
            asShapeFill: c.localName === "sp",
          });
          continue;
        }

        if (c.localName === "graphicFrame") {
          const x = readXfrm(child(c, NS_P, "xfrm"));
          const graphicData = deep(c, NS_A, "graphicData");
          const uri = graphicData?.getAttribute("uri") ?? "";
          if (!x) continue;
          const kind: PptxFrame["kind"] = uri.endsWith("/chart") ? "chart" : uri.endsWith("/table") ? "table" : uri.endsWith("/diagram") ? "diagram" : "other";
          let partPath: string | null = null;
          if (kind === "chart" && graphicData) {
            const chartEl = children(graphicData).find((g) => g.localName === "chart");
            const cid = chartEl?.getAttributeNS(NS_R, "id");
            const rel = cid ? rels.get(cid) : undefined;
            if (rel && !rel.external) partPath = resolvePart(dir, rel.target);
          }
          const table = kind === "table" && graphicData ? readTable(graphicData) : undefined;
          frames.push({ slideIndex, kind, box: toBox(map(x.x, x.y, x.cx, x.cy)), partPath, ...(table ? { table } : {}) });
        }
      }
    };
    visit(spTree, IDENTITY);
  }

  const formats = new Map<string, PptxPicture["format"]>();
  for (const p of pictures) {
    if (!formats.has(p.mediaPath)) {
      const bytes = await zip.files[p.mediaPath].async("uint8array");
      formats.set(p.mediaPath, formatOf(p.mediaPath, bytes.subarray(0, 16)));
    }
    p.format = formats.get(p.mediaPath)!;
  }

  return { slideCount: order.length, slideSize, pictures, frames };
}

/** Classify every picture; see the header for the classes. */
export function classifyPptxPictures(v: PptxVisuals): Map<PptxPicture, PictureClass> {
  const out = new Map<PptxPicture, PictureClass>();
  // Slides each media file appears on, and at which (rounded) place.
  const slidesByMedia = new Map<string, Set<number>>();
  const slidesByMediaPlace = new Map<string, Set<number>>();
  const place = (p: PptxPicture) => `${p.mediaPath}@${p.box.x.toFixed(2)},${p.box.y.toFixed(2)},${p.box.w.toFixed(2)},${p.box.h.toFixed(2)}`;
  for (const p of v.pictures) {
    (slidesByMedia.get(p.mediaPath) ?? slidesByMedia.set(p.mediaPath, new Set()).get(p.mediaPath)!).add(p.slideIndex);
    (slidesByMediaPlace.get(place(p)) ?? slidesByMediaPlace.set(place(p), new Set()).get(place(p))!).add(p.slideIndex);
  }
  const many = (n: number) => n >= MIN_REPEAT_SLIDES && n >= v.slideCount * REPEAT_SHARE;
  for (const p of v.pictures) {
    const vw = Math.max(0, Math.min(1, p.box.x + p.box.w) - Math.max(0, p.box.x));
    const vh = Math.max(0, Math.min(1, p.box.y + p.box.h) - Math.max(0, p.box.y));
    const area = vw * vh; // visible share of the slide
    const reused = many(slidesByMedia.get(p.mediaPath)!.size);
    if (area >= FULL_BLEED_AREA && reused) out.set(p, "background");
    else if (many(slidesByMediaPlace.get(place(p))!.size)) out.set(p, "repeated");
    else if (area < SMALL_AREA) out.set(p, "small");
    else out.set(p, "content");
  }
  return out;
}

/** Per-file AI images rule (owner, 2026-10-15): any content picture = no AI images. */
export function fileHasContentImages(v: PptxVisuals): boolean {
  for (const c of classifyPptxPictures(v).values()) if (c === "content") return true;
  return false;
}
