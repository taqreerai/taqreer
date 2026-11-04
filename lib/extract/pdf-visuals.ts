// Enhance phase 2 (docs/enhance-visuals-plan.md, section 10): find every picture
// placed on each page of a PDF upload, with the region it actually SHOWS, and cut
// it out of the original bitmap. Same idea and classes as the PPTX path
// (pptx-visuals + pptx-asset-crops), no model involved.
//
// Source of truth is `pdftocairo -svg` (one page per call), NOT `pdftohtml -xml`:
// the latter reports each image's unclipped rectangle, which is wrong for any
// deck that crops pictures with clip paths (Canva: rounded photos, oversized
// bitmaps). The SVG keeps, per image, its transform, every ancestor clip path
// and its soft mask:
//   visible region = image box intersected with all clips
//   cut-out        = that region mapped back into the bitmap's own pixels
//   transparency   = the soft mask (a second bitmap, luminance = alpha)
//
// Only axis-aligned and quarter-turn placements are cut (rotation baked into the
// file, so the slide needs no rotated box); anything else is flagged
// `needsPageCrop` like an EMF in the PPTX path. A mask that is a flat opacity
// rectangle (a faded picture) is treated as decoration.
//
// Page-sized pictures (one image covering the page, almost no text layer) are
// classified `pagescan` when most pages of the file look like that. Two kinds:
//   artwork  an illustration with its text painted in (a cover, a lesson poster):
//            carried as a "page" picture, which the slide shows full-bleed as its
//            background (the words are inside it, so it is not re-typeset)
//   scan     a document scan / screenshot (mostly white): not carried, the model
//            reads the page image as before
// Flat images (one colour: drop shadows, glows, solid fills) are never carried.
//
// Untrusted input: a user's PDF runs through poppler (already true for the page
// rasterization), the SVG is parsed with xmldom after the base64 payloads are cut
// out of it, and every decode goes through sharp with a pixel cap.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import sharp from "sharp";
import { PICTURE_THRESHOLDS, type Box, type PictureClass } from "@/lib/extract/pptx-visuals";
import type { PptxAsset } from "@/lib/extract/pptx-asset-crops";

const execFileAsync = promisify(execFile);

const MAX_PAGES = 80; // pages after this keep the old photo handling
const PAGE_PARALLEL = 2; // pdftocairo + xml parse per page; the host has 2 cores
const PAGE_TIMEOUT_MS = 60_000;
const TOOL_TIMEOUT_MS = 120_000;
const MAX_SVG_BYTES = 300 * 1024 * 1024;
const MAX_PICS_PER_PAGE = 120;
const MAX_PIXELS = 100_000_000; // sharp decode cap per bitmap
const MAX_EDGE = 2400;
const JPEG_QUALITY = 85;
const MAX_ASSET_BYTES = 15 * 1024 * 1024; // bucket limit is 20 MB
const MIN_VISIBLE_PT = 6; // a visible region thinner than this is a hairline, not a picture
const SCAN_MAX_WORDS = 15;
const SCAN_MIN_PAGES = 3;
const SCAN_SHARE = 0.5;
const DECOR_ASPECT = 8; // a small picture this much longer than wide is a strip, not a picture
const FLAT_SD = 6; // colour spread (0..255) under which an image is a single flat colour
const FLAT_SEMI_SHARE = 0.35; // ...and this share of it is semi-transparent: a shadow / glow
const SCAN_WHITE_SHARE = 0.3; // a page-sized picture with this much white is a scan, not artwork
const DECOR_TILES = 3; // the same small picture this many times on one page is a pattern

// pagescan: a scanned / screenshot page. faded: a picture drawn at a flat
// opacity. decor: a small picture tiled several times on one page (torn-paper
// edges, a dot, a divider), or a hairline strip.
export type PdfPictureClass = PictureClass | "pagescan" | "faded" | "decor";

// An asset ready to store. cls "page" = a page-sized artwork (see header).
export type PdfAsset = Omit<PptxAsset, "cls"> & {
  cls: PptxAsset["cls"] | "page";
  // A mostly white flat page (a scan, or line drawings on white), kept only so
  // lib/extract/page-regions.ts can look for pictures on it. Never shown as it is.
  scan?: boolean;
};

type Mat = [number, number, number, number, number, number];
type Rect = [number, number, number, number];

export type PdfPicture = {
  pageIndex: number; // 0-based, the page = the slide
  mediaKey: string; // hash of the bitmap: the same picture on many pages shares it
  box: Box; // visible region as fractions of the page
  // The bitmap and the matrix that places it (page units), to cut it later.
  bytes: Buffer;
  maskBytes: Buffer | null;
  imgW: number; // the bitmap's size in the SVG's own units
  imgH: number;
  matrix: Mat;
  visible: Rect; // page units
  faded: boolean; // soft mask is a flat opacity rectangle
  skewed: boolean; // placed at an angle other than a quarter turn
};

export type PdfVisuals = {
  pageCount: number;
  scannedPages: number;
  wordsByPage: number[]; // text layer word count per scanned page
  pictures: PdfPicture[];
};

// ── Tools ──────────────────────────────────────────────────────────────

function bins(name: string, envVar: string): string[] {
  return [process.env[envVar], name, `/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

export async function runTool(name: string, envVar: string, args: string[], timeout: number): Promise<string> {
  let lastErr: unknown;
  for (const bin of bins(name, envVar)) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
      return stdout;
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`${name} is not installed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

// ── Matrix / geometry helpers ──────────────────────────────────────────

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function parseTransform(s: string | null): Mat {
  let m: Mat = IDENTITY;
  if (!s) return m;
  for (const t of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.some((n) => !Number.isFinite(n))) continue;
    let T: Mat = IDENTITY;
    if (t[1] === "matrix" && v.length === 6) T = v as Mat;
    else if (t[1] === "translate") T = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (t[1] === "scale") T = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (t[1] === "rotate") {
      const r = ((v[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      T = [cos, sin, -sin, cos, 0, 0];
      if (v.length === 3) T = mul(mul([1, 0, 0, 1, v[1], v[2]], T), [1, 0, 0, 1, -v[1], -v[2]]);
    }
    m = mul(m, T);
  }
  return m;
}

function applyPt(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function boundsOf(pts: [number, number][]): Rect {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a: Rect, b: Rect): Rect | null {
  const r: Rect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}

function transformedBounds(m: Mat, r: Rect): Rect {
  return boundsOf([applyPt(m, r[0], r[1]), applyPt(m, r[2], r[1]), applyPt(m, r[0], r[3]), applyPt(m, r[2], r[3])]);
}

// ── One page's SVG → placements ────────────────────────────────────────

type Placement = {
  blob: number;
  maskBlob: number | "flat" | null;
  imgW: number;
  imgH: number;
  matrix: Mat;
  visible: Rect;
  skewed: boolean;
};

function childElements(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as XmlElement);
  return out;
}

function hrefOf(el: XmlElement): string {
  return el.getAttribute("xlink:href") || el.getAttribute("href") || "";
}

function blobIndex(href: string): number | null {
  const m = /^blob:(\d+)$/.exec(href);
  return m ? Number(m[1]) : null;
}

function clipBounds(clip: XmlElement): Rect | null {
  const pts: [number, number][] = [];
  for (const c of childElements(clip)) {
    if (c.tagName === "path") {
      const n = (c.getAttribute("d") ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    } else if (c.tagName === "rect") {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(c.getAttribute(k) ?? 0));
      pts.push([x, y], [x + w, y + h]);
    }
  }
  return pts.length > 0 && pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? boundsOf(pts) : null;
}

export function parsePageSvg(svg: string): { width: number; height: number; placements: Placement[]; blobs: string[] } {
  // Cut the (huge) base64 payloads out before the XML parse.
  const blobs: string[] = [];
  const stripped = svg.replace(/(xlink:href|href)="data:image\/(?:png|jpe?g);base64,([^"]*)"/g, (_m, attr: string, b64: string) => {
    blobs.push(b64);
    return `${attr}="blob:${blobs.length - 1}"`;
  });
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(stripped, "image/svg+xml");
  const root = doc.documentElement as XmlElement | null;
  const vb = root ? /^\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(root.getAttribute("viewBox") ?? "") : null;
  if (!root || !vb) return { width: 0, height: 0, placements: [], blobs };
  const width = Number(vb[1]), height = Number(vb[2]);

  const ids = new Map<string, XmlElement>();
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as XmlElement;
    const id = el.getAttribute("id");
    if (id) ids.set(id, el);
  }
  const byRef = (href: string) => ids.get(href.replace(/^#/, ""));

  const maskBlobOf = (maskId: string): number | "flat" => {
    const me = ids.get(maskId);
    if (!me) return "flat";
    for (const im of Array.from(me.getElementsByTagName("image"))) {
      const b = blobIndex(hrefOf(im as XmlElement));
      if (b != null) return b;
    }
    for (const u of Array.from(me.getElementsByTagName("use"))) {
      const ref = byRef(hrefOf(u as XmlElement));
      if (ref?.tagName === "image") {
        const b = blobIndex(hrefOf(ref));
        if (b != null) return b;
      }
    }
    return "flat";
  };

  const placements: Placement[] = [];
  const page: Rect = [0, 0, width, height];
  const visit = (el: XmlElement, m: Mat, clips: Rect[], mask: number | "flat" | null, depth: number): void => {
    if (depth > 30 || placements.length > MAX_PICS_PER_PAGE * 4) return;
    const tag = el.tagName;
    if (tag === "defs" || tag === "clipPath" || tag === "mask" || tag === "pattern" || tag === "style") return;
    const m2 = mul(m, parseTransform(el.getAttribute("transform")));
    let cl = clips;
    const cp = /#([^)\s]+)/.exec(el.getAttribute("clip-path") ?? "");
    if (cp) {
      const ce = ids.get(cp[1]);
      const lb = ce ? clipBounds(ce) : null;
      if (lb) cl = [...cl, transformedBounds(m2, lb)];
    }
    const mk = /#([^)\s]+)/.exec(el.getAttribute("mask") ?? "");
    const mask2 = mk ? maskBlobOf(mk[1]) : mask;
    if (tag === "use") {
      const ref = byRef(hrefOf(el));
      if (ref) visit(ref, mul(m2, [1, 0, 0, 1, Number(el.getAttribute("x") ?? 0) || 0, Number(el.getAttribute("y") ?? 0) || 0]), cl, mask2, depth + 1);
      return;
    }
    if (tag === "image") {
      const blob = blobIndex(hrefOf(el));
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(el.getAttribute(k) ?? 0));
      if (blob == null || !(w > 0) || !(h > 0)) return;
      let vis: Rect | null = transformedBounds(m2, [x, y, x + w, y + h]);
      for (const c of cl) vis = vis ? intersect(vis, c) : null;
      vis = vis ? intersect(vis, page) : null;
      if (!vis || vis[2] - vis[0] < MIN_VISIBLE_PT || vis[3] - vis[1] < MIN_VISIBLE_PT) return;
      const ref = Math.max(Math.abs(m2[0]), Math.abs(m2[1]), Math.abs(m2[2]), Math.abs(m2[3]), 1e-9);
      const zero = (n: number) => Math.abs(n) <= 1e-3 * ref;
      const upright = zero(m2[1]) && zero(m2[2]);
      const quarter = zero(m2[0]) && zero(m2[3]);
      placements.push({ blob, maskBlob: mask2, imgW: w, imgH: h, matrix: [m2[0], m2[1], m2[2], m2[3], m2[4] + m2[0] * x + m2[2] * y, m2[5] + m2[1] * x + m2[3] * y], visible: vis, skewed: !(upright || quarter) });
      return;
    }
    for (const c of childElements(el)) visit(c, m2, cl, mask2, depth + 1);
  };
  for (const c of childElements(root)) visit(c, IDENTITY, [], null, 0);
  return { width, height, placements, blobs };
}

// ── The whole file ─────────────────────────────────────────────────────

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function extractPdfPictures(buffer: Buffer): Promise<PdfVisuals> {
  const dir = await mkdtemp(path.join(tmpdir(), "tq-pdfpics-"));
  try {
    const pdf = path.join(dir, "in.pdf");
    await writeFile(pdf, buffer);
    const info = await runTool("pdfinfo", "PDFINFO_BIN", [pdf], TOOL_TIMEOUT_MS);
    const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
    if (!(pageCount > 0)) throw new Error("pdf has no pages");
    const scannedPages = Math.min(pageCount, MAX_PAGES);

    const text = await runTool("pdftotext", "PDFTOTEXT_BIN", ["-enc", "UTF-8", "-l", String(scannedPages), pdf, "-"], TOOL_TIMEOUT_MS);
    const chunks = text.split("\f");
    const wordsByPage = Array.from({ length: scannedPages }, (_, i) => (chunks[i] ?? "").split(/\s+/).filter(Boolean).length);

    const mediaCache = new Map<string, Buffer>();
    const decode = (b64: string): { key: string; bytes: Buffer } => {
      const key = createHash("sha1").update(b64).digest("hex").slice(0, 16);
      let bytes = mediaCache.get(key);
      if (!bytes) {
        bytes = Buffer.from(b64, "base64");
        mediaCache.set(key, bytes);
      }
      return { key, bytes };
    };

    const perPage = await mapPool(
      Array.from({ length: scannedPages }, (_, i) => i),
      PAGE_PARALLEL,
      async (pageIndex): Promise<PdfPicture[]> => {
        const out = path.join(dir, `p${pageIndex + 1}.svg`);
        await runTool("pdftocairo", "PDFTOCAIRO_BIN", ["-svg", "-f", String(pageIndex + 1), "-l", String(pageIndex + 1), pdf, out], PAGE_TIMEOUT_MS);
        const svg = await readFile(out, "utf8");
        if (svg.length > MAX_SVG_BYTES) throw new Error(`page ${pageIndex + 1} svg too large`);
        await rm(out, { force: true });
        const { width, height, placements, blobs } = parsePageSvg(svg);
        if (!width || !height) return [];
        const area = (p: Placement) => (p.visible[2] - p.visible[0]) * (p.visible[3] - p.visible[1]);
        return placements
          .sort((a, b) => area(b) - area(a))
          .slice(0, MAX_PICS_PER_PAGE)
          .map((p) => {
            const img = decode(blobs[p.blob] ?? "");
            const mask = typeof p.maskBlob === "number" ? decode(blobs[p.maskBlob] ?? "") : null;
            return {
              pageIndex,
              mediaKey: img.key,
              box: { x: p.visible[0] / width, y: p.visible[1] / height, w: (p.visible[2] - p.visible[0]) / width, h: (p.visible[3] - p.visible[1]) / height },
              bytes: img.bytes,
              maskBytes: mask?.bytes ?? null,
              imgW: p.imgW,
              imgH: p.imgH,
              matrix: p.matrix,
              visible: p.visible,
              faded: p.maskBlob === "flat",
              skewed: p.skewed,
            };
          })
          .filter((p) => p.bytes.length > 0);
      },
    );
    // Document order within a page: top to bottom, then left to right.
    const pictures = perPage.flatMap((list) => list.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x));
    return { pageCount, scannedPages, wordsByPage, pictures };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Classification (same classes and limits as the PPTX path) ─────────

export function classifyPdfPictures(v: PdfVisuals): Map<PdfPicture, PdfPictureClass> {
  const T = PICTURE_THRESHOLDS;
  const out = new Map<PdfPicture, PdfPictureClass>();
  const pagesByMedia = new Map<string, Set<number>>();
  const pagesByPlace = new Map<string, Set<number>>();
  const place = (p: PdfPicture) => `${p.mediaKey}@${p.box.x.toFixed(2)},${p.box.y.toFixed(2)},${p.box.w.toFixed(2)},${p.box.h.toFixed(2)}`;
  for (const p of v.pictures) {
    (pagesByMedia.get(p.mediaKey) ?? pagesByMedia.set(p.mediaKey, new Set()).get(p.mediaKey)!).add(p.pageIndex);
    (pagesByPlace.get(place(p)) ?? pagesByPlace.set(place(p), new Set()).get(place(p))!).add(p.pageIndex);
  }
  const tiles = new Map<string, number>();
  for (const p of v.pictures) tiles.set(`${p.pageIndex}:${p.mediaKey}`, (tiles.get(`${p.pageIndex}:${p.mediaKey}`) ?? 0) + 1);
  const many = (n: number) => n >= T.minRepeatSlides && n >= v.scannedPages * T.repeatShare;
  const area = (p: PdfPicture) => p.box.w * p.box.h;
  const lone = (p: PdfPicture) => !many(pagesByMedia.get(p.mediaKey)!.size) && !many(pagesByPlace.get(place(p))!.size);
  const looksScanned = (p: PdfPicture) => area(p) >= T.fullBleedArea && (v.wordsByPage[p.pageIndex] ?? 0) < SCAN_MAX_WORDS && lone(p);
  // A scan file: most pages are a single full-page picture with no text.
  const scanPages = new Set(v.pictures.filter((p) => !p.faded && looksScanned(p)).map((p) => p.pageIndex));
  // (a 1 or 2 page file qualifies when every page looks like that)
  const isScanFile = scanPages.size >= Math.min(SCAN_MIN_PAGES, v.scannedPages) && scanPages.size >= v.scannedPages * SCAN_SHARE;

  for (const p of v.pictures) {
    if (p.faded) out.set(p, "faded");
    else if (area(p) >= T.fullBleedArea && many(pagesByMedia.get(p.mediaKey)!.size)) out.set(p, "background");
    else if (many(pagesByPlace.get(place(p))!.size)) out.set(p, "repeated");
    else if (area(p) < T.smallArea) {
      const long = Math.max(p.visible[2] - p.visible[0], p.visible[3] - p.visible[1]);
      const short = Math.max(1, Math.min(p.visible[2] - p.visible[0], p.visible[3] - p.visible[1]));
      const tiled = (tiles.get(`${p.pageIndex}:${p.mediaKey}`) ?? 0) >= DECOR_TILES;
      out.set(p, long / short >= DECOR_ASPECT || tiled ? "decor" : "small");
    }
    else if (isScanFile && looksScanned(p)) out.set(p, "pagescan");
    else out.set(p, "content");
  }
  return out;
}

// ── Cutting the pictures out ───────────────────────────────────────────

type Cut = { bytes: Buffer; contentType: "image/jpeg" | "image/png"; width: number; height: number };

function sharpOf(input: Buffer | Uint8Array, raw?: { width: number; height: number; channels: 3 | 4 }) {
  return sharp(input, { failOn: "none", limitInputPixels: MAX_PIXELS, ...(raw ? { raw } : {}) });
}

async function cutPicture(p: PdfPicture): Promise<Cut> {
  const meta = await sharpOf(p.bytes).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error("no dimensions");

  // Full bitmap as RGBA, with the soft mask folded into alpha.
  const rgba = await sharpOf(p.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = rgba.data;
  if (p.maskBytes) {
    const m = await sharpOf(p.maskBytes)
      .flatten({ background: "#000000" })
      .resize(W, H, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    for (let i = 0; i < W * H; i++) data[i * 4 + 3] = Math.round((data[i * 4 + 3] * m[i]) / 255);
  }

  // Visible region (page units) back into bitmap pixels.
  const [a, b, c, d, e, f] = p.matrix;
  const ref = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1e-9);
  const quarter = Math.abs(a) <= 1e-3 * ref && Math.abs(d) <= 1e-3 * ref;
  const [x0, y0, x1, y1] = p.visible;
  const ur = quarter ? [(y0 - f) / b, (y1 - f) / b] : [(x0 - e) / a, (x1 - e) / a];
  const vr = quarter ? [(x0 - e) / c, (x1 - e) / c] : [(y0 - f) / d, (y1 - f) / d];
  const sx = W / p.imgW, sy = H / p.imgH;
  const left = Math.max(0, Math.round(Math.min(...ur) * sx));
  const top = Math.max(0, Math.round(Math.min(...vr) * sy));
  const right = Math.min(W, Math.round(Math.max(...ur) * sx));
  const bottom = Math.min(H, Math.round(Math.max(...vr) * sy));
  if (right - left < 2 || bottom - top < 2) throw new Error("empty crop");

  let img = sharpOf(data, { width: W, height: H, channels: 4 }).extract({ left, top, width: right - left, height: bottom - top });
  // Upright on the page: transpose for a quarter turn, then undo the mirrors.
  const stage = async (s: sharp.Sharp) => {
    const out = await s.raw().toBuffer({ resolveWithObject: true });
    return sharpOf(out.data, { width: out.info.width, height: out.info.height, channels: 4 });
  };
  if (quarter) img = await stage(img.rotate(90));
  if (quarter) img = await stage(img.flop());
  const xRev = quarter ? c < 0 : a < 0;
  const yRev = quarter ? b < 0 : d < 0;
  if (xRev) img = await stage(img.flop());
  if (yRev) img = await stage(img.flip());
  img = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });

  const stats = await sharp(await img.clone().png().toBuffer()).stats();
  const alphaMin = stats.channels[3]?.min ?? 255;
  const hasAlpha = alphaMin < 250;
  const encode = (i: sharp.Sharp) =>
    hasAlpha
      ? i.png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : i.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  let enc = await encode(img);
  if (enc.data.length > MAX_ASSET_BYTES) enc = await encode(sharpOf(enc.data).resize({ width: 1600, height: 1600, fit: "inside" }));
  return { bytes: enc.data, contentType: hasAlpha ? "image/png" : "image/jpeg", width: enc.info.width, height: enc.info.height };
}

// Flat single-colour images (drop shadows, glows, solid fills) and how white a
// picture is, from a 48 px thumbnail of the cut.
async function pixelStats(bytes: Buffer): Promise<{ flat: boolean; whiteShare: number }> {
  const { data } = await sharpOf(bytes)
    .resize({ width: 48, height: 48, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0, semi = 0, transparent = 0, white = 0;
  const sum = [0, 0, 0], sumSq = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 16) {
      transparent++;
      continue;
    }
    n++;
    if (a < 235) semi++;
    if (Math.min(data[i], data[i + 1], data[i + 2]) > 228) white++;
    for (let c = 0; c < 3; c++) {
      sum[c] += data[i + c];
      sumSq[c] += data[i + c] * data[i + c];
    }
  }
  if (n === 0) return { flat: true, whiteShare: 0 };
  const sd = [0, 1, 2].reduce((t, c) => t + Math.sqrt(Math.max(0, sumSq[c] / n - (sum[c] / n) ** 2)), 0) / 3;
  // One colour AND either a solid fill (nothing transparent) or a soft-edged
  // shadow / glow. A hard-edged one-colour logo on transparency is kept.
  const flat = sd < FLAT_SD && (transparent === 0 || semi / n >= FLAT_SEMI_SHARE);
  return { flat, whiteShare: white / n };
}

/**
 * Content + small pictures (and page-sized artwork) as ready-to-store asset
 * files (ids like "s07-a1"). Flat images and document scans are left out.
 */
export async function buildPdfAssets(
  visuals: PdfVisuals,
  classes: Map<PdfPicture, PdfPictureClass>,
  opts?: { whiteScans?: boolean },
): Promise<PdfAsset[]> {
  const perPage = new Map<number, number>();
  const keep = visuals.pictures.filter((p) => {
    const c = classes.get(p);
    return c === "content" || c === "small" || c === "pagescan";
  });
  const planned = keep.map((p) => {
    const n = (perPage.get(p.pageIndex) ?? 0) + 1;
    perPage.set(p.pageIndex, n);
    return { p, assetId: `s${String(p.pageIndex + 1).padStart(2, "0")}-a${n}` };
  });
  const built = await mapPool(planned, 3, async ({ p, assetId }): Promise<PdfAsset | null> => {
    const c = classes.get(p);
    const base = {
      assetId,
      slideIndex: p.pageIndex,
      cls: (c === "pagescan" ? "page" : c) as PdfAsset["cls"],
      box: p.box,
      aspect: Math.round(((p.visible[2] - p.visible[0]) / Math.max(1, p.visible[3] - p.visible[1])) * 100) / 100,
      rotationDeg: 0, // quarter turns are baked into the file
      altText: null,
    };
    if (p.skewed) return c === "pagescan" ? null : { ...base, file: { kind: "needsPageCrop" } };
    try {
      const cut = await cutPicture(p);
      const stats = await pixelStats(cut.bytes);
      if (stats.flat) return null;
      const white = c === "pagescan" && stats.whiteShare >= SCAN_WHITE_SHARE; // a scan / screenshot, not artwork
      if (white && !opts?.whiteScans) return null;
      return { ...base, ...(white ? { scan: true } : {}), file: { kind: "image", bytes: cut.bytes, contentType: cut.contentType, width: cut.width, height: cut.height } };
    } catch {
      return c === "pagescan" ? null : { ...base, file: { kind: "needsPageCrop" } };
    }
  });
  return built.filter((a): a is PdfAsset => a !== null);
}
