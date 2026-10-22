// Stock photos from Pexels for real, specific subjects (owner, 2026-10-22).
//
// The image model invents: it cannot draw a real flag, landmark, city or a
// particular animal or object faithfully (a generated Saudi flag came out as
// plain green cloth). A box marked data-gensource="stock" carries a short
// English search query instead of a prompt; the fill pipeline asks Pexels for
// it, stores a COPY in our own bucket (never hotlinks) and fills the box like
// a generated image. AI images stay for illustrative and mood pictures, so a
// deck keeps one look.
//
// Pexels licence: free for commercial use, attribution not required (we log
// the photographer). Not allowed: redistributing the photos as a stock
// library, so the stored row is marked size "pexels:<id>" and the public
// /free-stock-images gallery leaves those rows out. Rate limit: 200 requests
// per hour, 20,000 per month.

import type { GeneratedImageResult } from "@/lib/images/gpt-image";

const API = "https://api.pexels.com/v1/search";
const TIMEOUT_MS = 15_000;
const MAX_QUERY_CHARS = 100;

type PexelsPhoto = {
  id: number;
  photographer?: string;
  src?: { large2x?: string; large?: string; original?: string };
};

function apiKey(): string | null {
  return process.env.Pexels_KEY || process.env.PEXELS_API_KEY || null;
}

export function stockPhotosEnabled(): boolean {
  return apiKey() !== null;
}

/**
 * The first Pexels photo for `query` in the box's orientation, downloaded,
 * as a GeneratedImageResult (size = "pexels:<photo id>"). Null when there is
 * no key, no result or the request fails.
 */
export async function findStockPhoto(
  query: string,
  aspect: "landscape" | "portrait" | "square",
): Promise<(GeneratedImageResult & { photographer: string | null }) | null> {
  const key = apiKey();
  const q = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  if (!key || !q) return null;
  try {
    const url = `${API}?query=${encodeURIComponent(q)}&per_page=5&orientation=${aspect}`;
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { photos?: PexelsPhoto[] };
    const photo = body.photos?.find((p) => p.src?.large2x || p.src?.large);
    const src = photo?.src?.large2x ?? photo?.src?.large;
    if (!photo || !src || !src.startsWith("https://images.pexels.com/")) return null;
    const img = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!img.ok) return null;
    const bytes = Buffer.from(await img.arrayBuffer());
    return { b64: bytes.toString("base64"), size: `pexels:${photo.id}`, photographer: photo.photographer ?? null };
  } catch {
    return null;
  }
}
