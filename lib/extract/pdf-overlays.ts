// A picture as the PDF's reader sees it (owner, 2026-11-04).
//
// A PDF stores a picture whole, with anything laid over it drawn separately. A
// Canva cover had a heart over a Turkish flag and an Arabic sign over "OKUL";
// extraction took the bitmap underneath, so the deck showed what the author had
// covered (prod cmw2nqwvn0051666d5en5bkp7, slide 1).
//
// Each picture is compared with the rendered page. Where something covers part
// of it, the crop of the rendered page replaces the bitmap. Left alone:
//   - live words over a picture: the redesign retypes them, so baking them in
//     would show them twice. A word box counts only when most of it differs,
//     which means a patch sits under the word, not just the letters.
//   - pictures filling most of the page: backgrounds are meant to sit under
//     other things.
//   - a picture that is mostly see-through (a frame, a mock-up) or that does not
//     match the page overall (a mis-placed crop): the render would be wrong.
//   - anything touching the picture's edge: a neighbouring picture, a frame or a
//     round mask. A real cover sits fully inside the picture, and only that
//     counts (checked on 24 recent PDFs: edge differences were almost all wrong).
// Any failure keeps the bitmap, as before. Server-only.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ppmToPng } from "@/lib/extract/pdf-to-png";
import { runTool, type PdfAsset } from "@/lib/extract/pdf-visuals";

const COMPARE_DPI = 72;
const MAX_CROP_DPI = 300;
const SAMPLE_WIDTH = 256;
const SAMPLE_BLUR = 1; // hides the pixel or so a render and a bitmap sit apart
const PIXEL_DIFF = 40; // of 255, on the worst channel
const WORD_PATCH_SHARE = 0.6; // of a word box differing: a patch, not just letters
const MIN_PATCH = 0.0008; // of the picture: under this is noise
const MAX_PATCH = 0.25; // of the picture: over this is not a small cover
const MIN_SOLID = 0.5; // of the picture opaque: under this it is a frame or a cut-out
const MAX_MISMATCH = 0.35; // of its opaque part differing: the crop is not this picture
const EDGE_MARGIN = 3; // sample pixels: a patch this close to the edge touches it
const MAX_PICTURE_AREA = 0.6; // of the page: over this is a background
const MIN_CROP_PX = 32;
const TOOL_TIMEOUT_MS = 60_000;

type Box = { x: number; y: number; w: number; h: number };

/** Whether something other than live words sits fully inside the picture. */
export function hasInnerPatch(
  drawn: Buffer, // the rendered crop, RGB
  bitmap: Buffer, // the extracted picture at the same size, RGBA
  width: number,
  height: number,
  words: readonly Box[], // word boxes as fractions of the picture
): boolean {
  const differs = new Uint8Array(width * height);
  let opaque = 0;
  let opaqueDiffers = 0;
  for (let i = 0; i < width * height; i++) {
    const a = bitmap[i * 4 + 3] / 255;
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const flat = bitmap[i * 4 + c] * a + drawn[i * 3 + c] * (1 - a);
      worst = Math.max(worst, Math.abs(flat - drawn[i * 3 + c]));
    }
    if (worst > PIXEL_DIFF) differs[i] = 1;
    if (a > 0.9) {
      opaque += 1;
      opaqueDiffers += differs[i];
    }
  }
  if (opaque < width * height * MIN_SOLID || opaqueDiffers > opaque * MAX_MISMATCH) return false;
  for (const w of words) {
    const x0 = Math.max(0, Math.floor(w.x * width));
    const y0 = Math.max(0, Math.floor(w.y * height));
    const x1 = Math.min(width, Math.ceil((w.x + w.w) * width));
    const y1 = Math.min(height, Math.ceil((w.y + w.h) * height));
    let hit = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hit += differs[y * width + x];
    const cells = (x1 - x0) * (y1 - y0);
    if (cells <= 0 || hit / cells >= WORD_PATCH_SHARE) continue;
    for (let y = y0; y < y1; y++) differs.fill(0, y * width + x0, y * width + x1);
  }
  // One pass of wear removes single-pixel lines along detail.
  const solid = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (differs[i] && differs[i - 1] && differs[i + 1] && differs[i - width] && differs[i + width]) solid[i] = 1;
    }
  }
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let start = 0; start < solid.length; start++) {
    if (!solid[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let area = 0;
    let touchesEdge = false;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      area += 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x < EDGE_MARGIN || y < EDGE_MARGIN || x >= width - EDGE_MARGIN || y >= height - EDGE_MARGIN) touchesEdge = true;
      for (const n of [i - 1, i + 1, i - width, i + width]) {
        if (n >= 0 && n < solid.length && solid[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const share = area / (width * height);
    if (!touchesEdge && share >= MIN_PATCH && share <= MAX_PATCH) return true;
  }
  return false;
}

async function renderPage(pdf: string, page: number, dpi: number, dir: string): Promise<Buffer> {
  const out = path.join(dir, `p${page}-${dpi}`);
  await runTool("pdftoppm", "PDFTOPPM_BIN", ["-r", String(dpi), "-f", String(page), "-l", String(page), "-singlefile", pdf, out], TOOL_TIMEOUT_MS);
  const bytes = await readFile(`${out}.ppm`);
  await rm(`${out}.ppm`, { force: true });
  return ppmToPng(bytes);
}

/** Word boxes on a page, as fractions of the page. */
async function pageWords(pdf: string, page: number): Promise<Box[]> {
  const xml = await runTool("pdftotext", "PDFTOTEXT_BIN", ["-bbox", "-f", String(page), "-l", String(page), pdf, "-"], TOOL_TIMEOUT_MS);
  const size = /<page width="([\d.]+)" height="([\d.]+)"/.exec(xml);
  if (!size) return [];
  const W = Number(size[1]);
  const H = Number(size[2]);
  return [...xml.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)].map((m) => ({
    x: Number(m[1]) / W,
    y: Number(m[2]) / H,
    w: (Number(m[3]) - Number(m[1])) / W,
    h: (Number(m[4]) - Number(m[2])) / H,
  }));
}

function cropOf(box: Box, width: number, height: number) {
  const left = Math.max(0, Math.round(box.x * width));
  const top = Math.max(0, Math.round(box.y * height));
  return {
    left,
    top,
    width: Math.min(width - left, Math.round(box.w * width)),
    height: Math.min(height - top, Math.round(box.h * height)),
  };
}

/** Replace, in place, every picture something covers with what the page shows. Returns how many. */
export async function replaceCoveredPictures(assets: PdfAsset[], pdfBytes: Buffer): Promise<number> {
  const candidates = assets.filter(
    (a) => a.cls === "content" && a.file.kind === "image" && !a.file.animated && a.box.w * a.box.h < MAX_PICTURE_AREA,
  );
  if (candidates.length === 0) return 0;
  const dir = await mkdtemp(path.join(tmpdir(), "tq-overlays-"));
  let replaced = 0;
  try {
    const pdf = path.join(dir, "in.pdf");
    await writeFile(pdf, pdfBytes);
    for (const slideIndex of new Set(candidates.map((a) => a.slideIndex))) {
      const page = slideIndex + 1;
      const [render, words] = await Promise.all([renderPage(pdf, page, COMPARE_DPI, dir), pageWords(pdf, page)]);
      const meta = await sharp(render).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      if (!W || !H) continue;
      for (const a of candidates.filter((c) => c.slideIndex === slideIndex)) {
        if (a.file.kind !== "image") continue;
        const crop = cropOf(a.box, W, H);
        if (crop.width < MIN_CROP_PX || crop.height < MIN_CROP_PX) continue;
        const width = SAMPLE_WIDTH;
        const height = Math.max(1, Math.round((crop.height / crop.width) * width));
        const drawn = await sharp(render).extract(crop).resize(width, height, { fit: "fill" }).removeAlpha().blur(SAMPLE_BLUR).raw().toBuffer();
        const bitmap = await sharp(a.file.bytes, { failOn: "none" }).resize(width, height, { fit: "fill" }).ensureAlpha().blur(SAMPLE_BLUR).raw().toBuffer();
        const inside = words
          .filter((w) => w.x + w.w > a.box.x && w.x < a.box.x + a.box.w && w.y + w.h > a.box.y && w.y < a.box.y + a.box.h)
          .map((w) => ({ x: (w.x - a.box.x) / a.box.w, y: (w.y - a.box.y) / a.box.h, w: w.w / a.box.w, h: w.h / a.box.h }));
        if (!hasInnerPatch(drawn, bitmap, width, height, inside)) continue;
        // Sharp enough to stand in for the bitmap it replaces.
        const dpi = Math.min(MAX_CROP_DPI, Math.ceil((COMPARE_DPI * a.file.width) / crop.width));
        const sharper = await renderPage(pdf, page, Math.max(COMPARE_DPI, dpi), dir);
        const big = await sharp(sharper).metadata();
        const cut = cropOf(a.box, big.width ?? 0, big.height ?? 0);
        const bytes = await sharp(sharper).extract(cut).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
        a.file = { kind: "image", bytes, contentType: "image/jpeg", width: cut.width, height: cut.height };
        a.aspect = Math.round((cut.width / cut.height) * 100) / 100;
        replaced += 1;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return replaced;
}
