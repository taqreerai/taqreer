// Phase 18 (Enhance overhaul) — generation-time per-slide rasterizer.
//
// The enhance redesign feeds Claude one PNG per source slide (so it
// SEES each slide's visual identity) paired with that slide's exact
// text. Unlike the extract-time PDF upload this replaces, rasterization
// happens at GENERATION time and the images are TRANSIENT — uploaded to
// the Anthropic Files API, then flushed once the deck is saved (see
// deck-generate.ts). Nothing persists between runs.
//
// Pipeline: download the ORIGINAL upload from the Supabase staging
// bucket (by the `sourcePath` stored on the enhance source) → normalize
// to PDF (PPTX → LibreOffice; PDF passes through) → `pdftoppm` → one PNG
// buffer per page, in presentation order. The page order lines up 1:1
// with `textPerSlide` (both follow LibreOffice/PPTX presentation order),
// so image[i] ↔ textPerSlide[i] ↔ rendered page i+1.

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { pptxToPdf } from "./pptx-to-pdf";
import { pdfToPngs } from "./pdf-to-png";

// Same bucket the upload flows stage originals into (mirrors
// app/api/extract/route.ts + inngest/functions/extract-source.ts). Kept
// inline rather than shared so this module has no cross-import coupling
// to the Inngest function.
const SOURCE_FILES_BUCKET = "source-files";

const PPTX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

/**
 * Download the original enhance upload from Supabase and rasterize it
 * to one PNG buffer per slide (presentation order).
 *
 * @param sourcePath  object key in the `source-files` bucket
 *                    (`${userId}/extract/${jobId}/${fileName}`)
 * @param sourceMime  the original upload's MIME (drives PPTX-vs-PDF)
 *
 * Throws on a missing object or an unreadable/zero-page PDF — the
 * caller (deck-generate prep step) surfaces it to Inngest's retry +
 * onFailure path.
 */
export async function sourceToSlideImages(
  sourcePath: string,
  sourceMime: string,
): Promise<Buffer[]> {
  const admin = getSupabaseAdmin();
  const { data: download, error: dlError } = await admin.storage
    .from(SOURCE_FILES_BUCKET)
    .download(sourcePath);
  if (dlError || !download) {
    throw new Error(
      `Enhance source not found at ${sourcePath}: ${dlError?.message ?? "no data"}`,
    );
  }
  const sourceBytes = Buffer.from(await download.arrayBuffer());

  // Normalize to PDF. PPTX → LibreOffice (same path extract-source
  // uses); PDF uploads pass through unchanged.
  const pdfBytes = PPTX_MIMES.has(sourceMime)
    ? await pptxToPdf(sourceBytes)
    : sourceBytes;

  const pngs = await pdfToPngs(pdfBytes);
  if (pngs.length === 0) {
    throw new Error(`Rasterizer produced zero pages for ${sourcePath}`);
  }
  return pngs;
}
