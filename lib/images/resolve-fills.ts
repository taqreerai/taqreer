// Server-only: resolve reserved gen-image boxes (genid → public URL) from the
// TWO authoritative sources, so every read path sees the same image the user
// sees live. This is the single source of truth shared by:
//   • the status route (live-fill poll → DeckView `filledImages`)
//   • hydrateManifestImages (server PNG / PDF export read path)
// Keeping them on ONE resolver is deliberate: they drifted before (the export
// path read only DB rows, so a REGENERATED image - whose row deck-image-warm
// never re-marks `ready` - was invisible to PNG/PDF export while the live view
// showed it via the warmed-file fallback). One function → they can't drift.
//
// The two sources (context/images.md §12; identity is genid + promptHash):
//   1. `ready` GeneratedImage rows on the version — authoritative post-
//      reconcile; their storageUrl already encodes the FINAL prompt's hash.
//   2. WARM image FILENAMES stored under `${projectId}/gen/` by
//      deck-image-warm (mid-stream fills AND every regen) with NO DB row. We
//      match each live box's `${genid}-${hash}.jpg` against this set — a stale
//      draft hash simply isn't present, so it can't be surfaced.
// Source 2 is why a regen survives export: regen fires deck-image-warm (which
// only stores the file + broadcasts, no row write) with no end-of-deck
// reconcile behind it, so the DB row stays non-ready — but the file is there.

import { prisma } from "@/lib/prisma";
import {
  listWarmedImageFiles,
  publicGeneratedImageUrl,
  genImageHash,
  genImageFileName,
} from "@/lib/images/store";

/**
 * Resolve `genid → public image URL` for a set of reserved boxes.
 *
 * @param genBoxes genid → the box's CURRENT prompt (from the live manifest /
 *   the slide HTML). Hashing the current prompt is what makes a drifted or
 *   regenerated box resolve to its NEW image, never a discarded draft's.
 * Returns only the boxes that actually have a stored image; a box still
 * generating (no ready row AND no warmed file yet) is omitted.
 */
export async function resolveGenImageFills(args: {
  projectId: string;
  versionId: string | null;
  genBoxes: Map<string, string>;
}): Promise<Map<string, string>> {
  const { projectId, versionId, genBoxes } = args;
  const fills = new Map<string, string>();
  if (genBoxes.size === 0) return fills;

  const [ready, warmedFiles] = await Promise.all([
    versionId
      ? prisma.generatedImage.findMany({
          where: {
            presentationVersionId: versionId,
            status: "ready",
            storageUrl: { not: null },
          },
          select: { genid: true, storageUrl: true },
        })
      : Promise.resolve([] as { genid: string; storageUrl: string | null }[]),
    listWarmedImageFiles(projectId).catch((err) => {
      // Storage-list blip → degrade to DB-ready fills only (never throw out of
      // a best-effort enrichment). Log it: a persistent failure would silently
      // drop warmed/regenerated images from export + live fill.
      console.warn(
        `[image-fills] listWarmedImageFiles failed for ${projectId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return new Set<string>();
    }),
  ]);

  const readyByGenid = new Map<string, string>();
  for (const r of ready) if (r.storageUrl) readyByGenid.set(r.genid, r.storageUrl);

  for (const [genid, prompt] of genBoxes) {
    // Identity is (genid + promptHash): resolve to the CURRENT prompt's image,
    // never a stale one. The current prompt's file is `${genid}-${hash}.jpg`.
    const hash = genImageHash(prompt);
    const fileName = genImageFileName(genid, hash);
    // A ready DB row wins ONLY when its stored path encodes the CURRENT hash. A
    // row left over from a since-changed prompt (e.g. an in-place data-genimage
    // edit that didn't clear it) must NOT beat the warmed file for the new
    // prompt — that would export a discarded image (its storageUrl for the
    // matching hash is byte-identical to publicGeneratedImageUrl anyway).
    const dbUrl = readyByGenid.get(genid);
    if (dbUrl && dbUrl.includes(fileName)) {
      fills.set(genid, dbUrl);
      continue;
    }
    // Otherwise the warmed storage file for the CURRENT hash (regen / mid-
    // stream / lost broadcast — no ready row, but the file is there).
    if (warmedFiles.has(fileName)) {
      fills.set(genid, publicGeneratedImageUrl(projectId, genid, hash));
    }
  }
  return fills;
}
