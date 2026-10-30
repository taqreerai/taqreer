// Enhance: tell real PHOTOS apart from graphics (diagrams, scanned pages,
// screenshots, charts drawn as pictures), and clean up washed-out photos before
// they are stored (owner, 2026-10-20: "bad photos make the whole deck look bad").
//
// Owner rule (2026-10-15): an original picture is never swapped, only enhanced
// keeping its subject. This is the free, automatic part of that: levels,
// contrast, a little saturation, light sharpening, and a modest upscale of small
// photos. Graphics are never touched (their labels and lines must stay exact).
// The AI restoration (studio, paid) lives in lib/images/gpt-image.ts.
//
// Pure pixel statistics on a 256 px thumbnail, no model involved.

import sharp from "sharp";

// photo: a real photograph. graphic: few colours (a diagram, a texture, an
// illustration). document: paper-like (a scanned page, a screenshot of text).
export type PictureKind = "photo" | "graphic" | "document";

export type EnhancedPicture = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  kind: PictureKind;
  enhanced: boolean;
  // Cut-out artwork (a transparent PNG: template waves, swooshes, borders):
  // template decoration, not a picture the user's content depends on.
  cutout?: boolean;
  // 0 (crisp, rich, large) .. 1 (small, soft, faded): measured on the ORIGINAL
  // before any clean-up; ranks photos for the refresh (lib/extract/photo-refresh).
  badness: number;
};

const SAMPLE = 256;
// Below this long edge a photo is upscaled (to UPSCALE_TO) so it holds up at
// slide size; sharp's lanczos keeps edges clean, it cannot invent detail.
const SMALL_EDGE = 1000;
const UPSCALE_TO = 1600;

type Stats = {
  lightShare: number; // pixels brighter than paper (~215+) and nearly grey
  // the same, for the most paper-like third of the picture (left / middle /
  // right, top / middle / bottom): a page with a photo on one side and text on
  // the other is a document, not a photo
  maxThirdLight: number;
  uniqueColors: number; // distinct 5-bit-per-channel colours
  meanSat: number; // 0..1
  p2: number; // luminance percentiles, 0..255
  p98: number;
  sharpness: number; // variance of the luminance Laplacian on the sample
};

async function sample(bytes: Buffer): Promise<Stats> {
  const { data, info } = await sharp(bytes)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const hist = new Uint32Array(256);
  const lumAt = new Float32Array(n);
  const colors = new Set<number>();
  let light = 0;
  let satSum = 0;
  const thirds = new Float64Array(6); // cols 0..2, rows 3..5
  const cw = info.width / 3;
  const ch = info.height / 3;
  for (let i = 0; i < data.length; i += info.channels) {
    const px = i / info.channels;
    const x = px % info.width;
    const y = Math.floor(px / info.width);
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[lum]++;
    lumAt[px] = lum;
    satSum += sat;
    if (lum >= 215 && sat < 0.12) {
      light++;
      thirds[Math.min(2, Math.floor(x / cw))]++;
      thirds[3 + Math.min(2, Math.floor(y / ch))]++;
    }
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * p) return v;
    }
    return 255;
  };
  // Laplacian variance: low on soft / blurry pictures.
  let lapSum = 0;
  let lapSq = 0;
  let lapN = 0;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < info.width - 1; x++) {
      const i = y * info.width + x;
      const l = 4 * lumAt[i] - lumAt[i - 1] - lumAt[i + 1] - lumAt[i - info.width] - lumAt[i + info.width];
      lapSum += l;
      lapSq += l * l;
      lapN++;
    }
  }
  const lapMean = lapN ? lapSum / lapN : 0;
  const sharpness = lapN ? lapSq / lapN - lapMean * lapMean : 0;
  const maxThirdLight = Math.max(...Array.from(thirds, (v) => v / (n / 3)));
  return { lightShare: light / n, maxThirdLight, uniqueColors: colors.size, meanSat: satSum / n, p2: pct(0.02), p98: pct(0.98), sharpness };
}

/** Documents sit on paper (much near-white overall or in one third); graphics use few colours. */
export function kindFromStats(s: Stats): PictureKind {
  if (s.lightShare > 0.38) return "document";
  if (s.maxThirdLight > 0.6) return "document";
  if (s.uniqueColors < 700) return "graphic";
  return "photo";
}

/** 0..1, higher = worse: low resolution, softness, fading. */
function badnessOf(s: Stats, width: number, height: number): number {
  const long = Math.max(width, height);
  const res = long >= 1400 ? 0 : long >= 900 ? 0.15 : long >= 600 ? 0.3 : 0.45;
  const soft = s.sharpness >= 400 ? 0 : s.sharpness >= 150 ? 0.15 : 0.3;
  const faded = isWashedOut(s) ? 0.25 : 0;
  return Math.min(1, res + soft + faded);
}

/** Faded: lifted blacks, dimmed whites, or drained colour. */
function isWashedOut(s: Stats): boolean {
  return s.p98 - s.p2 < 190 || s.p2 > 40 || s.meanSat < 0.16;
}

// A PNG with this share of transparent pixels is cut-out artwork (owner,
// 2026-10-23: a transparent template wave on a cover was classed a photo,
// because removeAlpha() fills the cut-out with black and the gradients then
// count as photo colours). Real photos with an alpha channel are opaque.
const CUTOUT_TRANSPARENT_SHARE = 0.15;

async function transparentShare(bytes: Buffer): Promise<number> {
  const meta = await sharp(bytes).metadata();
  if (!meta.hasAlpha) return 0;
  const { data } = await sharp(bytes)
    .resize(128, 128, { fit: "inside" })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (const v of data) if (v < 128) clear++;
  return data.length ? clear / data.length : 0;
}

/**
 * How much of a picture carries detail, plus a perceptual fingerprint. Used
 * to tell an empty PDF template background (a few corner shapes or dots on
 * paper) from a full-page artwork (a portfolio page of drawings and renders).
 * busyShare: share of 16px tiles (on a 256px sample) whose luminance varies.
 * fingerprint: 16x16 average hash, 256 bits as a 0/1 string.
 */
export async function detailProfile(bytes: Buffer): Promise<{ busyShare: number; fingerprint: string }> {
  const { data, info } = await sharp(bytes)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const T = 16;
  let busy = 0;
  let tiles = 0;
  for (let ty = 0; ty < H; ty += T) {
    for (let tx = 0; tx < W; tx += T) {
      let s = 0;
      let s2 = 0;
      let m = 0;
      for (let y = ty; y < Math.min(H, ty + T); y++) {
        for (let x = tx; x < Math.min(W, tx + T); x++) {
          const v = data[y * W + x];
          s += v;
          s2 += v * v;
          m++;
        }
      }
      if (Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2)) > 12) busy++;
      tiles++;
    }
  }
  const tiny = await sharp(bytes).resize(16, 16, { fit: "fill" }).greyscale().raw().toBuffer();
  const avg = tiny.reduce((acc, v) => acc + v, 0) / tiny.length;
  return { busyShare: tiles ? busy / tiles : 0, fingerprint: Array.from(tiny, (v) => (v > avg ? "1" : "0")).join("") };
}

/** Photo or graphic, from the bytes alone (the studio restore route refuses graphics). */
export async function pictureKind(bytes: Buffer): Promise<PictureKind> {
  try {
    return kindFromStats(await sample(bytes));
  } catch {
    return "graphic";
  }
}

export async function analyzeAndEnhance(input: {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}): Promise<EnhancedPicture> {
  const keep: EnhancedPicture = { ...input, kind: "graphic", enhanced: false, badness: 0 };
  if (input.contentType === "image/png") {
    try {
      if ((await transparentShare(input.bytes)) > CUTOUT_TRANSPARENT_SHARE) return { ...keep, cutout: true };
    } catch {
      // unreadable alpha: classify by colour as before
    }
  }
  let stats: Stats;
  try {
    stats = await sample(input.bytes);
  } catch {
    return keep;
  }
  const kind = kindFromStats(stats);
  if (kind === "document") return cleanDocument(input, keep);
  if (kind !== "photo") return { ...keep, kind };
  const badness = badnessOf(stats, input.width, input.height);

  const small = Math.max(input.width, input.height) < SMALL_EDGE;
  const washed = isWashedOut(stats);
  if (!small && !washed) return { ...keep, kind, badness };

  try {
    const meta = await sharp(input.bytes).metadata();
    const alpha = input.contentType === "image/png" && !!meta.hasAlpha;
    let img = sharp(input.bytes);
    if (small) {
      // At most 2.5x: beyond that lanczos only makes a bigger blur.
      const scale = Math.min(2.5, UPSCALE_TO / Math.max(input.width, input.height));
      img = img.resize(Math.round(input.width * scale), Math.round(input.height * scale), { kernel: "lanczos3" });
    }
    if (washed) {
      img = img.normalise({ lower: 1, upper: 99 }).modulate({ saturation: stats.meanSat < 0.16 ? 1.22 : 1.1 });
    }
    img = img.sharpen({ sigma: small ? 1 : 0.7 });
    const out = alpha
      ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return {
      bytes: out.data,
      contentType: alpha ? "image/png" : "image/jpeg",
      width: out.info.width,
      height: out.info.height,
      kind,
      enhanced: true,
      badness,
    };
  } catch {
    return { ...keep, kind, badness };
  }
}

// Screenshots and documents (owner, 2026-10-27): a gentle sharpen so an old,
// soft screenshot reads crisp at its own size. No upscale (the deck never shows
// it past its native width, carried-assets maxSize) and no AI: an image model
// garbles interface text.
async function cleanDocument(
  input: { bytes: Buffer; contentType: "image/jpeg" | "image/png"; width: number; height: number },
  keep: EnhancedPicture,
): Promise<EnhancedPicture> {
  try {
    const img = sharp(input.bytes).sharpen({ sigma: 0.5 });
    const out =
      input.contentType === "image/png"
        ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { ...keep, bytes: out.data, contentType: input.contentType, width: out.info.width, height: out.info.height, kind: "document", enhanced: true };
  } catch {
    return { ...keep, kind: "document" };
  }
}
