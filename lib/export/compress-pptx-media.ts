// Recompress a PPTX's embedded raster media to shrink the downloaded file.
//
// dom-to-pptx rasterises every image to PNG (toDataURL('image/png')), so an
// images-mode deck ships full-size lossless PNGs (several MB each) regardless
// of how the source was stored. This pass walks `ppt/media/*` and:
//   • opaque parts      → re-encode JPEG q82 (rename .png → .jpeg, rewrite the
//                          .rels Targets that point at it, and ensure a jpeg
//                          Default in [Content_Types].xml)
//   • transparent parts → keep PNG so logos/icons keep their alpha
//   • all parts         → cap the long edge at 1920px (a slide never needs more)
// A part is only swapped in when the re-encode is actually smaller.
//
// Runs in the browser (html-export is client-side) and operates on the zip's
// OWN bytes via createImageBitmap → canvas, so there's no cross-origin
// canvas-taint (a DOM-level <img> pass would hit that for storage-hosted art).
// Best-effort at the call site: any throw leaves the input blob untouched.

import type JSZipType from "jszip";

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.82;

export type MediaCompressStats = {
  scanned: number;
  recompressed: number;
  renamed: number;
  bytesBefore: number;
  bytesAfter: number;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// True if any pixel is non-opaque. JPEG can't carry alpha, so converting a
// transparent part to JPEG would flatten its transparency to black — we keep
// those as PNG.
function hasTransparency(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export async function compressPptxMedia(
  blob: Blob,
  JSZip: typeof JSZipType,
  stats: MediaCompressStats,
): Promise<Blob> {
  // Canvas + createImageBitmap are browser-only; bail untouched otherwise.
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return blob;
  }

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const mediaPaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/media\/[^/]+\.(png|jpe?g)$/i.test(p),
  );
  if (mediaPaths.length === 0) return blob;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return blob;

  const renames: { from: string; to: string }[] = [];

  for (const path of mediaPaths) {
    stats.scanned++;
    const orig = await zip.file(path)!.async("uint8array");
    stats.bytesBefore += orig.length;

    const isPng = /\.png$/i.test(path);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([orig as BlobPart]));
    } catch {
      stats.bytesAfter += orig.length;
      continue; // undecodable — leave as-is
    }

    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const transparent = isPng && hasTransparency(ctx, w, h);
    const targetType = transparent ? "image/png" : "image/jpeg";
    const out = await canvasToBlob(
      canvas,
      targetType,
      targetType === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
    if (!out) {
      stats.bytesAfter += orig.length;
      continue;
    }
    const outBytes = new Uint8Array(await out.arrayBuffer());

    // Keep the original whenever the re-encode doesn't actually save bytes
    // (small/simple PNGs can beat JPEG; an already-tight part stays put).
    if (outBytes.length >= orig.length) {
      stats.bytesAfter += orig.length;
      continue;
    }
    stats.recompressed++;
    stats.bytesAfter += outBytes.length;

    if (targetType === "image/jpeg" && isPng) {
      const to = path.replace(/\.png$/i, ".jpeg");
      zip.remove(path);
      zip.file(to, outBytes);
      renames.push({ from: path, to });
    } else {
      zip.file(path, outBytes); // same name (jpeg→jpeg or png→png)
    }
  }

  if (renames.length > 0) {
    stats.renamed = renames.length;
    // 1. Rewrite every .rels Target pointing at a renamed part. Targets are
    //    relative (`../media/imageN.png`); match the `/imageN.png` basename
    //    with its leading slash so `image1.png` can't clobber `image10.png`.
    const relsPaths = Object.keys(zip.files).filter((p) => /\.rels$/i.test(p));
    for (const rp of relsPaths) {
      let xml = await zip.file(rp)!.async("text");
      let changed = false;
      for (const { from, to } of renames) {
        const fromRef = "/" + from.slice("ppt/media/".length);
        const toRef = "/" + to.slice("ppt/media/".length);
        if (xml.includes(fromRef)) {
          xml = xml.split(fromRef).join(toRef);
          changed = true;
        }
      }
      if (changed) zip.file(rp, xml);
    }
    // 2. Ensure [Content_Types].xml declares jpeg (PptxGenJS only adds png).
    const ctPath = "[Content_Types].xml";
    const ct = zip.file(ctPath);
    if (ct) {
      let xml = await ct.async("text");
      if (!/Extension="jpe?g"/i.test(xml)) {
        xml = xml.replace(
          /<Types(\s[^>]*)?>/,
          (m) => `${m}<Default Extension="jpeg" ContentType="image/jpeg"/>`,
        );
        zip.file(ctPath, xml);
      }
    }
  }

  return await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
