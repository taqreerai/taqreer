// Sharper copies of real-world pictures (owner, 2026-10-28).
//
// A teacher's deck carried a soft web copy of the Saudi flag and a blurry
// photo of At-Turaif, shown far larger than their pixels. A generated image
// must never stand in for a real flag or place, but a real, sharper copy can:
//   flag   -> flagcdn.com's own 2560px rendering of that country's flag
//   place  -> a Pexels photo of the same named landmark, else a public-domain
//             / CC0 one from Wikimedia Commons (no credit line needed), each
//             confirmed by Haiku to show the same place
// Only pictures shown larger than their pixels are looked at. People are
// never identified or swapped: the identify prompt answers "none" for any
// picture with a person in it. The original stays stored (the studio's
// "Restore original"). Any failure keeps the original.

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { findStockPhoto } from "@/lib/images/pexels";

const MODEL = "claude-haiku-5-5";
const MAX_LOOKED_AT = 40;
const MAX_PLACES = 6;
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const UA = "Taqreer/1.0 (https://taqreer.ai)";
const OPEN_LICENSES = /^(public domain|pd|cc0|cc-zero)/i;

export type HdCandidate = { mediaKey: string; bytes: Buffer; aspect: number };
export type HdPicture = { bytes: Buffer; contentType: "image/jpeg" | "image/png"; width: number; height: number; source: string };

type Identified = { kind: "flag"; code: string } | { kind: "place"; name: string };

async function jpegPreview(bytes: Buffer, edge: number): Promise<string> {
  const jpg = await sharp(bytes, { failOn: "none" }).resize(edge, edge, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 75 }).toBuffer();
  return jpg.toString("base64");
}

async function ask(content: Anthropic.Messages.ContentBlockParam[], maxTokens: number): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const msg = await client.messages.create({ model: MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content }] });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function identify(list: readonly HdCandidate[]): Promise<Map<string, Identified>> {
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (let i = 0; i < list.length; i++) {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await jpegPreview(list[i].bytes, 448) } });
  }
  content.push({
    type: "text",
    text:
      `For each image answer one of:\n` +
      `- flag|<ISO 3166-1 alpha-2 code>: the picture is just one country's national flag (nothing else of importance in it)\n` +
      `- place|<its common English name>: the picture is a plain PHOTO (not a poster, illustration, drawing or a picture with written words on it) of one famous, clearly recognisable landmark or historic site, with no person as its subject\n` +
      `- none: anything else, including any picture whose subject is a person, a crowd, a document, a drawing or a generic scene\n` +
      `Never name a person. When unsure, answer none.\n` +
      `Reply with one line per image, exactly: <number>|<flag, place or none>|<code or name>`,
  });
  const out = new Map<string, Identified>();
  for (const line of (await ask(content, 300 + 30 * list.length)).split("\n")) {
    const m = line.trim().match(/^(\d+)\s*\|\s*(flag|place)\s*\|\s*(.+)$/i);
    const item = m ? list[Number(m[1]) - 1] : undefined;
    if (!m || !item) continue;
    const value = m[3].trim();
    if (m[2].toLowerCase() === "flag") {
      const code = value.toLowerCase();
      if (/^[a-z]{2}$/.test(code)) out.set(item.mediaKey, { kind: "flag", code });
    } else {
      const name = value.replace(/[^\p{L}\p{N} '’.,()-]/gu, "").trim().slice(0, 80);
      if (name.length >= 3) out.set(item.mediaKey, { kind: "place", name });
    }
  }
  return out;
}

async function download(url: string, allowedHost: RegExp, headers?: Record<string, string>): Promise<Buffer | null> {
  try {
    if (!allowedHost.test(new URL(url).hostname)) return null;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

async function toPicture(bytes: Buffer, source: string): Promise<HdPicture | null> {
  try {
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    const png = meta.format === "png";
    const { data, info } = png
      ? await sharp(bytes).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await sharp(bytes).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { bytes: data, contentType: png ? "image/png" : "image/jpeg", width: info.width, height: info.height, source };
  } catch {
    return null;
  }
}

async function wikimediaOpenPhoto(name: string): Promise<{ bytes: Buffer; source: string } | null> {
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8" +
    `&gsrsearch=${encodeURIComponent(`${name} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2000`;
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; width?: number; descriptionurl?: string; extmetadata?: { LicenseShortName?: { value?: string } } }[] }> };
    };
    for (const page of Object.values(body.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const license = info?.extmetadata?.LicenseShortName?.value ?? "";
      if (!info?.thumburl || (info.width ?? 0) < 1200 || !OPEN_LICENSES.test(license)) continue;
      const bytes = await download(info.thumburl, /^(upload|thumb)\.wikimedia\.org$/, { "User-Agent": UA });
      if (bytes) return { bytes, source: `wikimedia:${info.descriptionurl ?? ""}` };
    }
  } catch {
    /* none */
  }
  return null;
}

async function samePlace(original: Buffer, candidate: Buffer, name: string): Promise<boolean> {
  const reply = await ask(
    [
      { type: "text", text: "Picture A:" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await jpegPreview(original, 448) } },
      { type: "text", text: "Picture B:" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await jpegPreview(candidate, 448) } },
      {
        type: "text",
        text: `Is picture B a clear photo of the same place as picture A (${name.replace(/["<>]/g, "")}), possibly from another angle? It must be that exact place, not a similar one, and must not show text, a watermark or a person as its subject. Answer yes or no.`,
      },
    ],
    5,
  );
  return /^\s*yes/i.test(reply);
}

/** mediaKey -> a sharper copy of a flag or a famous place. Failure = an empty map. */
export async function findHdPictures(candidates: readonly HdCandidate[]): Promise<Map<string, HdPicture>> {
  const out = new Map<string, HdPicture>();
  if (!process.env.ANTHROPIC_API_KEY || candidates.length === 0) return out;
  const list = candidates.slice(0, MAX_LOOKED_AT);
  try {
    const found = await identify(list);
    let places = 0;
    for (const c of list) {
      const id = found.get(c.mediaKey);
      if (!id) continue;
      if (id.kind === "flag") {
        const bytes = await download(`https://flagcdn.com/w2560/${id.code}.png`, /^flagcdn\.com$/);
        const pic = bytes ? await toPicture(bytes, `flagcdn:${id.code}`) : null;
        if (pic) out.set(c.mediaKey, pic);
        continue;
      }
      if (places >= MAX_PLACES) continue;
      places++;
      const orientation = c.aspect > 1.15 ? "landscape" : c.aspect < 0.87 ? "portrait" : "square";
      const stock = await findStockPhoto(id.name, orientation);
      const stockBytes = stock ? Buffer.from(stock.b64, "base64") : null;
      if (stockBytes && (await samePlace(c.bytes, stockBytes, id.name))) {
        const pic = await toPicture(stockBytes, stock!.size);
        if (pic) out.set(c.mediaKey, pic);
        continue;
      }
      const open = await wikimediaOpenPhoto(id.name);
      if (open && (await samePlace(c.bytes, open.bytes, id.name))) {
        const pic = await toPicture(open.bytes, open.source);
        if (pic) out.set(c.mediaKey, pic);
      }
    }
  } catch (err) {
    console.error("[carry] hd pictures failed:", err);
  }
  return out;
}
