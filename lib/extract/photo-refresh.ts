// Enhance "Refresh my photos" (opt-in, owner 2026-10-20). Default is to keep
// every original photo (cleaned up, lib/extract/photo-enhance.ts). When the
// user turns this on, a LIMITED set of the deck's most important generic
// photos is replaced by new ones in the deck's style; everything else stays.
//
// The rule is deterministic given one cached tag per photo:
//   gates   a photo (not a diagram / document / icon), at least MIN_AREA of its
//           slide, tagged "subject" or "mood" by one Haiku vision call. People
//           ("person"), anything drawn or labelled ("diagram") and specific things ("specific": a product, brand,
//           building, real place, event, artwork) are NEVER replaced.
//   collage on a slide with 3+ photos only the largest may be replaced (one
//           new photo next to old ones looks worse than either).
//   score   size on the slide + alone on its slide + first slide / backdrop +
//           how bad the original looks (photo-enhance badness).
//   budget  one per slide, the same picture used on several slides counts
//           once, at most CAP_PAID (paid) / CAP_FREE (free) and one per 3 slides.
// "subject" photos are re-shot from the photo itself (image edit), so the
// mirror stays a mirror; "mood" photos are generated fresh from a description.
// The original stays stored: the studio offers "Restore original".

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { aspectForRatio, generateImage, restylePhoto } from "@/lib/images/gpt-image";
import { uploadSourceAsset } from "@/lib/storage/source-assets";

export const CAP_PAID = 8;
export const CAP_FREE = 2;
// "Replace all": every photo that passes the gates, up to this many (cost bound).
export const CAP_ALL = 24;
const MIN_AREA = 0.08;
const TAG_MODEL = "claude-haiku-4-5";
const MAX_TAGGED = 16;
const MAX_TAGGED_ALL = CAP_ALL + 8;
const PARALLEL = 3;

export type PhotoTag = "person" | "specific" | "diagram" | "subject" | "mood";

export type RefreshCandidate = {
  assetId: string;
  slideIndex: number;
  cls: string;
  kind: string | undefined;
  area: number; // visible share of its slide, 0..1
  badness: number;
  mediaKey: string; // same bytes = same picture
  photosOnSlide: number;
  largestOnSlide: boolean;
};

/** Importance used to rank candidates (higher first). */
export function refreshScore(c: RefreshCandidate): number {
  return (
    Math.min(1, c.area) +
    (c.photosOnSlide === 1 ? 0.3 : 0) +
    (c.slideIndex === 0 || c.cls === "backdrop" ? 0.3 : 0) +
    c.badness * 0.5
  );
}

/** Candidates that pass every gate except the tag, best first (what gets tagged). */
export function refreshPool(cands: readonly RefreshCandidate[], all = false): RefreshCandidate[] {
  return cands
    .filter(
      (c) =>
        c.kind === "photo" &&
        (c.cls === "content" || c.cls === "backdrop") &&
        c.area >= MIN_AREA &&
        (all || c.photosOnSlide < 3 || c.largestOnSlide),
    )
    .sort((a, b) => refreshScore(b) - refreshScore(a));
}

/** The replacements, as media keys, in priority order. Pure and deterministic. */
export function selectPhotoReplacements(
  cands: readonly RefreshCandidate[],
  tags: ReadonlyMap<string, PhotoTag>, // by mediaKey
  opts: { slideCount: number; paid: boolean; all?: boolean },
): string[] {
  const all = opts.all === true && opts.paid;
  const cap = all ? CAP_ALL : Math.min(opts.paid ? CAP_PAID : CAP_FREE, Math.ceil(opts.slideCount / 3));
  const usedSlides = new Set<number>();
  const picked: string[] = [];
  for (const c of refreshPool(cands, all)) {
    if (picked.length >= cap) break;
    const tag = tags.get(c.mediaKey);
    if (tag !== "subject" && tag !== "mood") continue;
    if (picked.includes(c.mediaKey)) continue;
    if (!all && usedSlides.has(c.slideIndex)) continue;
    usedSlides.add(c.slideIndex);
    picked.push(c.mediaKey);
  }
  return picked;
}

/** One Haiku vision call: a tag + a short description per picture. Failure = no tags (nothing replaced). */
export async function tagPhotos(
  pictures: readonly { mediaKey: string; bytes: Buffer }[],
  all = false,
): Promise<Map<string, { tag: PhotoTag; desc: string }>> {
  const out = new Map<string, { tag: PhotoTag; desc: string }>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || pictures.length === 0) return out;
  const list = pictures.slice(0, all ? MAX_TAGGED_ALL : MAX_TAGGED);
  try {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    for (let i = 0; i < list.length; i++) {
      const jpg = await sharp(list[i].bytes).resize(384, 384, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer();
      content.push({ type: "text", text: `Image ${i + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
    }
    content.push({
      type: "text",
      text:
        `For each image, give one tag:\n` +
        `- person: any person or face is visible (even small or from behind)\n` +
        `- specific: a particular product, brand, logo, building, real named place, event, artwork, or anything that matters as itself\n` +
        `- diagram: a diagram, drawing, chart, illustration, cartoon, screenshot, or anything with labels, arrows, numbers or text\n` +
        `- subject: a generic object or scene that illustrates a point (a mirror, a road, a lake reflection, a plant)\n` +
        `- mood: a generic decorative or atmosphere photo\n` +
        `When unsure, choose person, specific or diagram (those are never replaced).\n` +
        `Also describe what it shows in at most 20 English words.\n` +
        `Reply with one line per image, exactly: <number>|<tag>|<description>`,
    });
    const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const msg = await client.messages.create({ model: TAG_MODEL, max_tokens: 60 * list.length, temperature: 0, messages: [{ role: "user", content }] });
    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    for (const line of reply.split("\n")) {
      const m = line.trim().match(/^(\d+)\s*\|\s*(person|specific|diagram|subject|mood)\s*\|\s*(.{1,200})$/i);
      if (!m) continue;
      const item = list[Number(m[1]) - 1];
      if (item) out.set(item.mediaKey, { tag: m[2].toLowerCase() as PhotoTag, desc: m[3].trim() });
    }
  } catch {
    return new Map();
  }
  return out;
}

/**
 * Make the new photos and store them as new assets of the project. Returns
 * mediaKey -> new asset id for every replacement that worked (a failure keeps
 * the original, never fails the deck).
 */
export async function makeReplacements(opts: {
  projectId: string;
  picks: readonly {
    mediaKey: string;
    assetId: string;
    bytes: Buffer;
    contentType: string;
    width: number;
    height: number;
    tag: PhotoTag;
    desc: string;
  }[];
  styleHint: string; // e.g. the look's image direction
  palette: readonly string[];
}): Promise<Map<string, string>> {
  const done = new Map<string, string>();
  const colours = opts.palette.length ? ` Colour mood in harmony with ${opts.palette.slice(0, 3).join(", ")}, kept natural.` : "";
  const style = opts.styleHint || "Clean, modern, natural-light photography, sharp and well exposed.";
  const run = async (p: (typeof opts.picks)[number]) => {
    try {
      const ratio = p.width / p.height;
      const out =
        p.tag === "subject"
          ? await restylePhoto({
              bytes: await sharp(p.bytes).png().toBuffer(),
              contentType: "image/png",
              aspect: ratio,
              prompt: `Re-shoot this photo as a new, high-quality photograph: same subject and what it shows (${p.desc}), same kind of scene, better light, sharp detail, modern look. Style: ${style}${colours}`,
            })
          : await generateImage({ prompt: `${p.desc}. ${style}${colours}`, aspect: aspectForRatio(ratio) });
      const long = Math.min(2400, Math.max(1200, p.width, p.height));
      const tw = Math.round(p.width >= p.height ? long : (long * p.width) / p.height);
      const th = Math.round((tw * p.height) / p.width);
      const jpeg = await sharp(Buffer.from(out.b64, "base64"))
        .resize(tw, th, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      const newId = `${p.assetId}-new`.slice(0, 64);
      await uploadSourceAsset({ projectId: opts.projectId, assetId: newId, bytes: jpeg, contentType: "image/jpeg" });
      done.set(p.mediaKey, newId);
    } catch (err) {
      // Keep the original; logged so a provider problem is visible.
      console.warn("[photo-refresh] replacement failed, original kept:", p.assetId, p.tag, err instanceof Error ? err.message : String(err));
    }
  };
  for (let i = 0; i < opts.picks.length; i += PARALLEL) {
    await Promise.all(opts.picks.slice(i, i + PARALLEL).map(run));
  }
  return done;
}
