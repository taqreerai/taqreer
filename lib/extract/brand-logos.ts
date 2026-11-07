// Brand logos from a deck's template (owner, 2026-10-28).
//
// A ministry deck put its emblem on the slide LAYOUT: it showed on 26 of 30
// slides but sat in no slide's own shapes, and a logo repeated on most slides
// is dropped as template art (pptx-visuals classifyPptxPictures "repeated").
// Either way the redesign never got the real file and drew a text stand-in
// ("MEWA" in a circle, the English name reordered; prod cmvrptccn006zak6dflqd03ui).
//
// Candidates: a small picture in the header or footer band, shown on many
// slides, from the layouts / master or repeated on the slides themselves.
// One Haiku call confirms which are logos (a repeated small icon, a wave or a
// divider is not). Carried once for the whole deck as a LOGO entry; the
// redesign puts it in its chrome (CARRIED_LOGO_RULE). Any failure = none.

import Anthropic from "@anthropic-ai/sdk";
import { tracked } from "@/lib/anthropic/usage-log";
import JSZip from "jszip";
import sharp from "sharp";
import type { PictureClass, PptxVisuals, TemplatePicture } from "@/lib/extract/pptx-visuals";

const MODEL = "claude-haiku-5-5";
const MAX_LOGOS = 3;
const MAX_AREA = 0.06; // of the slide
const BAND = 0.25; // top or bottom share of the slide its centre sits in
const MIN_SHARE = 0.4; // of the slides it shows on
const LOGO_EDGE = 800;

export type BrandLogo = {
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number };
  slides: number[];
};

type Candidate = { mediaPath: string; box: BrandLogo["box"]; slides: number[] };

function looksLikeMark(box: Candidate["box"], slides: number, slideCount: number, slideAspect: number): boolean {
  const area = box.w * box.h;
  const cy = box.y + box.h / 2;
  const aspect = (box.w / Math.max(0.001, box.h)) * slideAspect;
  return (
    area > 0.001 &&
    area <= MAX_AREA &&
    (cy <= BAND || cy >= 1 - BAND) &&
    aspect >= 0.25 &&
    aspect <= 8 &&
    slides >= Math.max(2, Math.ceil(slideCount * MIN_SHARE))
  );
}

export function brandLogoCandidates(
  visuals: PptxVisuals,
  classes: ReadonlyMap<unknown, PictureClass>,
  template: { pictures: readonly TemplatePicture[] },
): Candidate[] {
  const slideAspect = visuals.slideSize.cx / Math.max(1, visuals.slideSize.cy);
  const byMedia = new Map<string, Candidate>();
  for (const t of template.pictures) {
    if (t.format !== "raster") continue;
    byMedia.set(t.mediaPath, { mediaPath: t.mediaPath, box: t.box, slides: t.slides });
  }
  // A logo pasted on each slide (not on the layout) is "repeated" too.
  for (const p of visuals.pictures) {
    if (classes.get(p) !== "repeated" || p.format !== "raster") continue;
    const prev = byMedia.get(p.mediaPath);
    if (prev) {
      if (!prev.slides.includes(p.slideIndex)) prev.slides = [...prev.slides, p.slideIndex].sort((a, b) => a - b);
    } else {
      byMedia.set(p.mediaPath, { mediaPath: p.mediaPath, box: p.box, slides: [p.slideIndex] });
    }
  }
  return [...byMedia.values()]
    .filter((c) => looksLikeMark(c.box, c.slides.length, visuals.slideCount, slideAspect))
    .sort((a, b) => b.slides.length - a.slides.length)
    .slice(0, MAX_LOGOS * 2);
}

/** The candidates Haiku confirms as an organisation's logo, as stored-ready bitmaps. */
export async function findBrandLogos(buffer: Buffer, candidates: readonly Candidate[]): Promise<BrandLogo[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || candidates.length === 0) return [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    const files: (BrandLogo & { preview: Buffer })[] = [];
    for (const c of candidates) {
      const media = Buffer.from(await zip.files[c.mediaPath].async("uint8array"));
      const meta = await sharp(media, { failOn: "none" }).metadata();
      const img = sharp(media, { failOn: "none" }).resize({ width: LOGO_EDGE, height: LOGO_EDGE, fit: "inside", withoutEnlargement: true });
      const { data, info } = meta.hasAlpha
        ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
      const preview = await sharp(data).resize(400, 400, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 75 }).toBuffer();
      files.push({
        bytes: data,
        contentType: meta.hasAlpha ? "image/png" : "image/jpeg",
        width: info.width,
        height: info.height,
        box: c.box,
        slides: c.slides,
        preview,
      });
    }
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    files.forEach((f, i) => {
      content.push({ type: "text", text: `Image ${i + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.preview.toString("base64") } });
    });
    content.push({
      type: "text",
      text:
        `These small pictures repeat in the header or footer of a slide deck. For each, answer yes if it is the logo, emblem, seal, crest or brand mark of an organisation, ministry, school or company (with or without its name), and no for anything else (a decorative shape, line, wave, pattern, icon, photo or plain text). ` +
        `Also answer no for a badge or watermark of the software or website that made the deck ("Made with ...", "Powered by ...", "Created in ...", a presentation app's own badge): it is not the presenter's organisation.\n` +
        `Reply with one line per image, exactly: <number>|<yes or no>`,
    });
    const client = tracked(new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }), "extract-brand-logos");
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content }],
    });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const yes = new Set<number>();
    for (const line of reply.split("\n")) {
      const m = line.trim().match(/^(\d+)\s*\|\s*yes\b/i);
      if (m) yes.add(Number(m[1]) - 1);
    }
    return files
      .filter((_, i) => yes.has(i))
      .slice(0, MAX_LOGOS)
      .map(({ preview: _preview, ...logo }) => logo);
  } catch (err) {
    console.error("[carry] brand logo check failed:", err);
    return [];
  }
}
