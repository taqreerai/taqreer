// Enhance phase 1, step 2 (docs/enhance-visuals-plan.md): turn the pictures
// found by pptx-visuals into ready-to-store asset files.
//
// Source is the ORIGINAL embedded media (full resolution, no slide background),
// trimmed by the slide's own crop (a:srcRect) and flipped like the slide shows
// it. Rotation is NOT baked in: it is returned so the slide can rotate the box.
// Long edge capped at MAX_EDGE; JPEG when opaque, PNG when the picture has
// transparency. Vector media (EMF / WMF) cannot be decoded here and is returned
// as `needsPageCrop` so the caller can cut it from the rendered page instead.
//
// Only "content" and "small" pictures become assets; "background" and
// "repeated" ones are template art and are dropped (classifyPptxPictures).

import JSZip from "jszip";
import sharp from "sharp";
import type { PictureClass, PptxPicture, PptxVisuals } from "@/lib/extract/pptx-visuals";

const MAX_EDGE = 2400;
const JPEG_QUALITY = 85;

export type PptxAsset = {
  assetId: string; // "s07-a1": slide 7 (1-based), first asset on it
  slideIndex: number;
  cls: Extract<PictureClass, "content" | "small">;
  box: PptxPicture["box"];
  // Shape aspect on the slide (width / height, in real units), so the
  // redesign can reserve a box of the same proportions.
  aspect: number;
  rotationDeg: number;
  altText: string | null;
  file:
    | { kind: "image"; bytes: Buffer; contentType: "image/jpeg" | "image/png"; width: number; height: number }
    | { kind: "needsPageCrop" };
};

export async function buildPptxAssets(
  buffer: Buffer,
  visuals: PptxVisuals,
  classes: Map<PptxPicture, PictureClass>,
): Promise<PptxAsset[]> {
  const zip = await JSZip.loadAsync(buffer);
  const perSlide = new Map<number, number>();
  const out: PptxAsset[] = [];
  const keep = visuals.pictures.filter((p) => {
    const c = classes.get(p);
    return c === "content" || c === "small";
  });

  for (const p of keep) {
    const n = (perSlide.get(p.slideIndex) ?? 0) + 1;
    perSlide.set(p.slideIndex, n);
    const assetId = `s${String(p.slideIndex + 1).padStart(2, "0")}-a${n}`;
    const aspect = (p.box.w * visuals.slideSize.cx) / Math.max(1, p.box.h * visuals.slideSize.cy);
    const base = {
      assetId,
      slideIndex: p.slideIndex,
      cls: classes.get(p) as PptxAsset["cls"],
      box: p.box,
      aspect,
      rotationDeg: p.rotationDeg,
      altText: p.altText,
    };
    if (p.format !== "raster") {
      out.push({ ...base, file: { kind: "needsPageCrop" } });
      continue;
    }
    try {
      const media = Buffer.from(await zip.files[p.mediaPath].async("uint8array"));
      // .rotate() with no argument applies EXIF orientation (phone photos).
      let img = sharp(media, { failOn: "none" }).rotate();
      const meta = await sharp(await img.toBuffer()).metadata();
      const W = meta.width ?? 0, H = meta.height ?? 0;
      if (!W || !H) throw new Error("no dimensions");
      if (p.srcRect) {
        const left = Math.round(W * p.srcRect.l), top = Math.round(H * p.srcRect.t);
        const width = Math.max(1, Math.round(W * (1 - p.srcRect.l - p.srcRect.r)));
        const height = Math.max(1, Math.round(H * (1 - p.srcRect.t - p.srcRect.b)));
        img = sharp(await img.toBuffer()).extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) });
      }
      if (p.flipH) img = img.flop();
      if (p.flipV) img = img.flip();
      img = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
      const hasAlpha = Boolean(meta.hasAlpha);
      const { data, info } = hasAlpha
        ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await img.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      out.push({
        ...base,
        file: { kind: "image", bytes: data, contentType: hasAlpha ? "image/png" : "image/jpeg", width: info.width, height: info.height },
      });
    } catch {
      // Undecodable raster (corrupt / exotic): cut it from the page render.
      out.push({ ...base, file: { kind: "needsPageCrop" } });
    }
  }
  return out;
}
