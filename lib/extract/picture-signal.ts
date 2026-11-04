// How a deck's own pictures will hold up in a redesign (owner, 2026-10-28).
//
// A teacher's collage deck (102 web pictures on 36 slides, 2.8 per slide, 38%
// shown larger than their pixels) redesigned with "keep" became a wall of
// mismatched, soft pictures (prod cmvsggdgs00iyak6dsgj0im3z). Measured at
// extraction, no AI call:
//   contentPictures  the deck's own content pictures (template art excluded)
//   collageShare     share of slides holding 3 or more of them
//   lowResShare      share shown wider than their pixels (under 0.75 px per px)
// Enhance's start questions read it: "replace" preselects "Replace all", and
// "photoRich" (many pictures, all sharp) suggests a photo-led style instead.
// On 6 recent decks it picked replace for the collage deck and a deck of soft
// web pictures, and kept a ministry report's sharp site photos.

import JSZip from "jszip";
import sharp from "sharp";
import { classifyPptxPictures, type PptxVisuals } from "@/lib/extract/pptx-visuals";
import { classifyPdfPictures, type PdfVisuals } from "@/lib/extract/pdf-visuals";

const MIN_PICTURES = 8;
const LOW_RES_SHARE = 0.3;
const COLLAGE_SHARE = 0.25;
const COLLAGE_PICTURES = 3;
const PICTURE_SLIDE_SHARE = 0.6; // photo-rich: most slides carry pictures
const LOW_RES_RATIO = 0.75;
const SHARP_SHARE = 0.1; // under this share of soft pictures, the set counts as sharp
const CANVAS_W = 1920;

export type PictureSignal = {
  contentPictures: number;
  collageShare: number;
  lowResShare: number;
  // The suggestion: replace the pictures, or keep them in a photo-led look.
  suggest: "replace" | "photoRich" | null;
  // A PDF whose pages are flat images: a redesign reads the words from them.
  flatPages?: boolean;
};

type Measured = { slideIndex: number; shownW: number; pixelW: number | null };

function decide(items: readonly Measured[], slideCount: number): PictureSignal {
  const perSlide = new Map<number, number>();
  for (const it of items) perSlide.set(it.slideIndex, (perSlide.get(it.slideIndex) ?? 0) + 1);
  const slides = Math.max(1, slideCount);
  const collageShare = [...perSlide.values()].filter((n) => n >= COLLAGE_PICTURES).length / slides;
  const sized = items.filter((it) => it.pixelW !== null);
  const low = sized.filter((it) => (it.pixelW as number) / Math.max(1, it.shownW) < LOW_RES_RATIO).length;
  const lowResShare = sized.length > 0 ? low / sized.length : 0;
  const many = items.length >= MIN_PICTURES;
  const weak = lowResShare >= LOW_RES_SHARE;
  const crowded = collageShare >= COLLAGE_SHARE;
  const allSharp = lowResShare < SHARP_SHARE;
  let suggest: PictureSignal["suggest"] = null;
  if (many && weak) suggest = "replace";
  // Crowded with sharp photos (a trip, an event): a photo-led look keeps them.
  else if (many && crowded) suggest = allSharp ? "photoRich" : "replace";
  else if (many && allSharp && perSlide.size / slides >= PICTURE_SLIDE_SHARE) suggest = "photoRich";
  return {
    contentPictures: items.length,
    collageShare: Math.round(collageShare * 100) / 100,
    lowResShare: Math.round(lowResShare * 100) / 100,
    suggest,
  };
}

async function widthOf(bytes: Uint8Array): Promise<number | null> {
  const m = await sharp(bytes, { failOn: "none" }).metadata().catch(() => null);
  return m?.width ?? null;
}

export async function pptxPictureSignal(buffer: Buffer, visuals: PptxVisuals): Promise<PictureSignal> {
  const zip = await JSZip.loadAsync(buffer);
  const classes = classifyPptxPictures(visuals);
  const items: Measured[] = [];
  const widths = new Map<string, number | null>();
  for (const p of visuals.pictures) {
    if (classes.get(p) !== "content") continue;
    let pixelW: number | null = null;
    if (p.format === "raster") {
      if (!widths.has(p.mediaPath)) widths.set(p.mediaPath, await widthOf(await zip.files[p.mediaPath].async("uint8array")));
      const w = widths.get(p.mediaPath) ?? null;
      // Pixels left after the slide's own crop.
      pixelW = w === null ? null : w * (1 - (p.srcRect ? p.srcRect.l + p.srcRect.r : 0));
    }
    items.push({ slideIndex: p.slideIndex, shownW: Math.min(1, p.box.w) * CANVAS_W, pixelW });
  }
  return decide(items, visuals.slideCount);
}

export async function pdfPictureSignal(visuals: PdfVisuals): Promise<PictureSignal> {
  const classes = classifyPdfPictures(visuals);
  const items: Measured[] = [];
  for (const p of visuals.pictures) {
    if (classes.get(p) !== "content") continue;
    items.push({ slideIndex: p.pageIndex, shownW: Math.min(1, p.box.w) * CANVAS_W, pixelW: await widthOf(p.bytes) });
  }
  return { ...decide(items, visuals.scannedPages), flatPages: [...classes.values()].includes("pagescan") };
}
