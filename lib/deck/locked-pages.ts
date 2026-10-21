// Free-plan teaser of an Enhance deck: the locked source slides' rendered pages.
//
// Generation only sends the VISIBLE pages to the model and flushes them, and
// per-slide text exists for PPTX only. A PDF upload therefore left the unlock
// with nothing to redesign from: a paid unlock (2026-10-20, project
// cmvgk67a6007euz6df49ba8c4) authored 25 slides holding only a page number.
// The locked pages are now kept as private assets of the deck (like carried
// pictures: deleted with the project) and the unlock reads them.

import sharp from "sharp";
import { readSourceAsset, uploadSourceAsset } from "@/lib/storage/source-assets";

export type LockedPage = { position: number; assetId: string }; // position is 1-based

const EDGE = 1600;

export function lockedPageAssetId(position: number): string {
  return `src-page-${String(position).padStart(3, "0")}`;
}

/** Store pages [from, to) (0-based) as JPEG assets; returns what was stored. */
export async function storeLockedPages(
  projectId: string,
  pages: readonly Buffer[],
  from: number,
  to: number,
): Promise<LockedPage[]> {
  const out: LockedPage[] = [];
  for (let i = from; i < Math.min(to, pages.length); i++) {
    const position = i + 1;
    const assetId = lockedPageAssetId(position);
    const jpeg = await sharp(pages[i])
      .resize(EDGE, EDGE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    await uploadSourceAsset({ projectId, assetId, bytes: jpeg, contentType: "image/jpeg" });
    out.push({ position, assetId });
  }
  return out;
}

/** Base64 JPEGs of the stored pages, in position order (missing ones skipped). */
export async function readLockedPages(
  projectId: string,
  pages: readonly LockedPage[],
): Promise<{ position: number; base64: string }[]> {
  const out: { position: number; base64: string }[] = [];
  for (const p of [...pages].sort((a, b) => a.position - b.position)) {
    const r = await readSourceAsset(projectId, p.assetId);
    if (r) out.push({ position: p.position, base64: r.bytes.toString("base64") });
  }
  return out;
}

/**
 * Slides with (almost) no content: under MIN_CHARS of visible text and no
 * picture, chart, table or drawing. An unlock that returns many of these
 * failed, whatever the model says.
 */
const MIN_CHARS = 12;
export function isEmptySlideHtml(html: string): boolean {
  const body = html.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  if (/<(img|svg|table|video|canvas)\b|data-chart=|data-table=|data-genimage=/i.test(body.replace(/<div class="tq-(bg|chrome)"[\s\S]*?<\/div>/gi, ""))) {
    return false;
  }
  const text = body.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, "");
  return text.length < MIN_CHARS;
}
