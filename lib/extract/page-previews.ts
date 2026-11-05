// The user's own pages, shown on the canvas while Enhance prepares (owner,
// 2026-11-05). The steps before the first slide take a minute or more, so the
// studio shows the source pages at once and each is replaced as its slide is
// built. Only the pages a free preview builds are stored here: locked pages stay
// locked. Private like every carried picture (lib/storage/source-assets), and
// deleted when the run ends: a whole source page must not outlive the wait,
// since anyone who can view the deck could otherwise open a page the owner has
// since removed. Best-effort: no previews, no harm. Server-only.

import sharp from "sharp";
import { SOURCE_ASSETS_BUCKET, uploadSourceAsset } from "@/lib/storage/source-assets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_PAGES = 30;
const PAGE_WIDTH = 960;
const PARALLEL = 4;

export function pagePreviewId(index: number): string {
  return `page-${String(index + 1).padStart(2, "0")}`;
}

/** Delete this run's previews. Never fails the run; a missing object is fine. */
export async function removePagePreviews(projectId: string): Promise<void> {
  const keys = Array.from({ length: MAX_PAGES }, (_, i) => `${projectId}/${pagePreviewId(i)}`);
  const { error } = await getSupabaseAdmin().storage.from(SOURCE_ASSETS_BUCKET).remove(keys);
  if (error) console.warn("[enhance] page preview cleanup failed:", error.message);
}

/** Store previews of these pages; returns how many are ready, in order from page 1. */
export async function storePagePreviews(projectId: string, pngs: readonly Buffer[]): Promise<number> {
  const pages = pngs.slice(0, MAX_PAGES);
  let ready = 0;
  try {
    for (let i = 0; i < pages.length; i += PARALLEL) {
      await Promise.all(
        pages.slice(i, i + PARALLEL).map(async (png, k) => {
          const bytes = await sharp(png).resize(PAGE_WIDTH, undefined, { withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
          await uploadSourceAsset({ projectId, assetId: pagePreviewId(i + k), bytes, contentType: "image/webp" });
        }),
      );
      ready = Math.min(pages.length, i + PARALLEL);
    }
  } catch (err) {
    console.warn("[enhance] page previews failed:", err instanceof Error ? err.message : err);
  }
  return ready;
}
