// Real photos of a NAMED subject (a person, a landmark) from Wikimedia
// Commons (owner, 2026-11-07: a Messi vs Ronaldo deck got a random young
// player for "What distinguishes Ronaldo?"). Pexels holds no celebrities and
// the image model will not draw real people, so a box the deck marks with
// data-genname="<English Wikipedia title>" looks up that article's lead
// picture here first.
//
// Only free licences hosted on Commons are used (Wikipedia's pageimages
// `pilicense=free`, then the Commons file page's own licence metadata): CC0,
// public domain, CC BY and CC BY-SA. Those licences require credit, so the
// author and licence are stamped small in the photo's corner. The photo is
// cropped to the box's shape first (attention crop keeps the face), so an
// object-fit:cover box shows the whole frame and the credit never gets cut.

import sharp from "sharp";
import type { GeneratedImageResult } from "@/lib/images/gpt-image";

type Aspect = "landscape" | "portrait" | "square";

const BOX_SIZE: Record<Aspect, { w: number; h: number }> = {
  landscape: { w: 1536, h: 1024 },
  portrait: { w: 1024, h: 1536 },
  square: { w: 1024, h: 1024 },
};
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "TaqreerBot/1.0 (https://taqreer.ai)";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 15 * 1024 * 1024;
const FREE_LICENCE = /^(?:cc0|public domain|pd\b|pd-|cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?:\s|$))/i;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

type PageInfo = { title?: string; missing?: string; pageimage?: string; pageprops?: { disambiguation?: string } };

/** The free lead picture's file name of a Wikipedia article, or null. */
async function leadImage(lang: "en" | "ar", name: string): Promise<string | null> {
  const base = `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&redirects=1&prop=pageimages|pageprops&piprop=name&pilicense=free`;
  const direct = (await getJson(`${base}&titles=${encodeURIComponent(name)}`)) as { query?: { pages?: PageInfo[] } } | null;
  let page = direct?.query?.pages?.[0];
  if (!page || page.missing !== undefined) {
    // Not an exact title: take the top search hit ("Ronaldo" → the article).
    const search = (await getJson(
      `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=2&action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(name)}`,
    )) as { query?: { search?: { title: string }[] } } | null;
    const title = search?.query?.search?.[0]?.title;
    if (!title) return null;
    const found = (await getJson(`${base}&titles=${encodeURIComponent(title)}`)) as { query?: { pages?: PageInfo[] } } | null;
    page = found?.query?.pages?.[0];
  }
  if (!page || page.pageprops?.disambiguation !== undefined) return null;
  return page.pageimage ?? null;
}

type FileInfo = { url: string; credit: string; title: string } | null;

const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/** Commons file URL + credit line, only for a raster photo under a free licence. */
async function commonsFile(file: string): Promise<FileInfo> {
  const data = (await getJson(
    `https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&action=query&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1600&titles=${encodeURIComponent(`File:${file}`)}`,
  )) as {
    query?: {
      pages?: {
        title?: string;
        missing?: boolean;
        imageinfo?: { thumburl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
      }[];
    };
  } | null;
  const page = data?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  // Missing here = the file lives on Wikipedia itself (often non-free): skip.
  if (!page || page.missing || !info?.thumburl) return null;
  if (!/^image\/(?:jpeg|png|webp)$/.test(info.mime ?? "")) return null;
  const meta = info.extmetadata ?? {};
  const licence = stripTags(meta.LicenseShortName?.value ?? "");
  if (!FREE_LICENCE.test(licence)) return null;
  const fullArtist = stripTags(meta.Artist?.value ?? "");
  const artist = fullArtist.length > 48 ? `${fullArtist.slice(0, 48).replace(/[\s,;]+\S*$/, "")}...` : fullArtist;
  const credit = [artist, licence, "Wikimedia Commons"].filter(Boolean).join(" · ");
  return { url: info.thumburl, credit, title: page.title ?? file };
}

async function download(url: string): Promise<Buffer | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  // Wikimedia's own media hosts only (thumbnails moved to thumb.* in 2026).
  if (host !== "upload.wikimedia.org" && host !== "thumb.wikimedia.org") return null;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 0 && buf.length <= MAX_BYTES ? buf : null;
}

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Crop to the box shape and stamp the credit in the bottom corner. */
async function framed(bytes: Buffer, aspect: Aspect, credit: string): Promise<Buffer> {
  const { w, h } = BOX_SIZE[aspect];
  const src = sharp(bytes).rotate();
  const meta = await src.metadata();
  const srcRatio = (meta.width ?? w) / (meta.height ?? h);
  const boxRatio = w / h;
  let photo: Buffer;
  if (srcRatio < boxRatio) {
    // Taller than the box (a portrait in a wide box): the attention crop
    // locked onto a shirt's badges and cut Messi's face off. Keep the top,
    // where a lead portrait's head is; when more than 40% of the height
    // would go, show the whole photo on a blurred copy of itself instead.
    const keptShare = srcRatio / boxRatio;
    if (keptShare >= 0.6) {
      photo = await src.resize(w, h, { fit: "cover", position: "top" }).toBuffer();
    } else {
      const backdrop = await sharp(bytes).rotate().resize(w, h, { fit: "cover" }).blur(40).modulate({ brightness: 0.7 }).toBuffer();
      const fg = await sharp(bytes).rotate().resize(w, h, { fit: "inside" }).toBuffer();
      photo = await sharp(backdrop).composite([{ input: fg, gravity: "center" }]).toBuffer();
    }
  } else {
    // Wider than the box: trim the sides around the interesting part.
    photo = await src.resize(w, h, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
  }
  const fontSize = Math.round(h * 0.022);
  const text = escXml(credit.length > 90 ? `${credit.slice(0, 87)}...` : credit);
  const padX = Math.round(fontSize * 0.7);
  const boxH = Math.round(fontSize * 1.9);
  // Width estimate for a sans face (~0.55em per char); the band is translucent
  // so a slightly long estimate costs nothing.
  const boxW = Math.min(w, Math.round(text.length * fontSize * 0.55) + padX * 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect x="${w - boxW}" y="${h - boxH}" width="${boxW}" height="${boxH}" fill="#000" fill-opacity="0.55"/>` +
    `<text x="${w - padX}" y="${h - boxH / 2}" text-anchor="end" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#fff">${text}</text>` +
    `</svg>`;
  return sharp(photo).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 88 }).toBuffer();
}

/**
 * A freely licensed real photo of `name` (an English Wikipedia title, Arabic
 * tried second), cropped to `aspect` with its credit stamped on. Null when the
 * article, a free lead picture or the download is missing: the caller falls
 * back to the box's own people-free stock search.
 */
export async function findCommonsPhoto(name: string, aspect: Aspect): Promise<GeneratedImageResult | null> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return null;
  try {
    for (const lang of ["en", "ar"] as const) {
      const file = await leadImage(lang, clean);
      if (!file) continue;
      const info = await commonsFile(file);
      if (!info) continue;
      const bytes = await download(info.url);
      if (!bytes) continue;
      const out = await framed(bytes, aspect, info.credit);
      console.info("commons_photo", { name: clean, file: info.title });
      return { b64: out.toString("base64"), size: `commons:${info.title.slice(0, 120)}` };
    }
  } catch (err) {
    console.warn("commons_photo_failed", { name: clean, error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}
