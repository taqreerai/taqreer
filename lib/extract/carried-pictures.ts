// Enhance phase 1, step 2 (docs/enhance-visuals-plan.md): at generation time,
// find the original pictures of a PPTX upload, store them in the private
// `source-assets` bucket under the project, and return the small manifest the
// prompt and the server-side enforcement need (no bytes: it rides an Inngest
// step result).
//
// Every slide's pictures are stored, not only the visible ones of a free-plan
// teaser, so an unlock later can place them too (the raw upload itself is
// purged after 24h by source-files-cleanup). PDF uploads go through
// lib/extract/pdf-visuals.ts (phase 2); a PDF has no native tables here yet.

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extractPptxVisuals, classifyPptxPictures } from "@/lib/extract/pptx-visuals";
import { buildPptxAssets, type PptxAsset } from "@/lib/extract/pptx-asset-crops";
import { buildPdfAssets, classifyPdfPictures, extractPdfPictures } from "@/lib/extract/pdf-visuals";
import { uploadSourceAsset } from "@/lib/storage/source-assets";
import type { TableSpec } from "@/lib/deck/visuals/table";

const SOURCE_FILES_BUCKET = "source-files";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";
// Upload concurrency: small files, a few at a time.
const UPLOAD_PARALLEL = 4;

export type CarriedPicture = {
  assetId: string;
  slideIndex: number; // presentation order, 0-based
  cls: "content" | "small";
  aspect: number; // width / height on the original slide
  altText: string | null;
};

// A native PPTX table, carried as its EXACT cells (step 3): the model reserves
// a box, the server fills it (lib/deck/carried-assets enforceCarriedTables).
export type CarriedTable = {
  tableId: string; // "s05-t1"
  slideIndex: number;
  spec: TableSpec;
};

export type CarriedPictures = {
  // Per-file AI images rule (owner, 2026-10-15): any CONTENT picture in the
  // file switches AI images off for the whole deck.
  hasContentImages: boolean;
  pictures: CarriedPicture[];
  // Pictures found but not storable here (EMF / WMF / undecodable): left to
  // the existing photo-slot handling until page crops land.
  skipped: number;
  tables: CarriedTable[];
};

export async function prepareCarriedPictures(opts: {
  projectId: string;
  sourcePath: string;
  sourceMime: string;
}): Promise<CarriedPictures> {
  if (opts.sourceMime !== PPTX_MIME && opts.sourceMime !== PDF_MIME) {
    return { hasContentImages: false, pictures: [], skipped: 0, tables: [] };
  }

  const { data, error } = await getSupabaseAdmin().storage.from(SOURCE_FILES_BUCKET).download(opts.sourcePath);
  if (error || !data) throw new Error(`carried pictures: source not found at ${opts.sourcePath}`);
  const buffer = Buffer.from(await data.arrayBuffer());

  let assets: PptxAsset[];
  let hasContentImages: boolean;
  let tables: CarriedTable[] = [];
  if (opts.sourceMime === PDF_MIME) {
    const visuals = await extractPdfPictures(buffer);
    const classes = classifyPdfPictures(visuals);
    hasContentImages = [...classes.values()].includes("content");
    assets = await buildPdfAssets(visuals, classes);
  } else {
    const visuals = await extractPptxVisuals(buffer);
    const classes = classifyPptxPictures(visuals);
    hasContentImages = [...classes.values()].includes("content");
    assets = await buildPptxAssets(buffer, visuals, classes);
    tables = tablesOf(visuals);
  }

  const storable = assets.filter((a) => a.file.kind === "image");
  for (let i = 0; i < storable.length; i += UPLOAD_PARALLEL) {
    await Promise.all(
      storable.slice(i, i + UPLOAD_PARALLEL).map((a) => {
        if (a.file.kind !== "image") return Promise.resolve();
        return uploadSourceAsset({
          projectId: opts.projectId,
          assetId: a.assetId,
          bytes: a.file.bytes,
          contentType: a.file.contentType,
        });
      }),
    );
  }

  return {
    hasContentImages,
    pictures: storable.map((a) => ({
      assetId: a.assetId,
      slideIndex: a.slideIndex,
      cls: a.cls,
      // The PICTURE's own proportions (after the slide's crop), not the shape's:
      // a stretched source shape would otherwise make object-fit: cover cut it.
      aspect: Math.round((a.file.kind === "image" ? a.file.width / a.file.height : a.aspect) * 100) / 100,
      altText: a.altText ? a.altText.slice(0, 200) : null,
    })),
    skipped: assets.length - storable.length,
    tables,
  };
}

// Native tables, numbered per slide in document order.
function tablesOf(visuals: Awaited<ReturnType<typeof extractPptxVisuals>>): CarriedTable[] {
  const perSlide = new Map<number, number>();
  const out: CarriedTable[] = [];
  for (const f of visuals.frames) {
    if (f.kind !== "table" || !f.table) continue;
    const n = (perSlide.get(f.slideIndex) ?? 0) + 1;
    perSlide.set(f.slideIndex, n);
    out.push({
      tableId: `s${String(f.slideIndex + 1).padStart(2, "0")}-t${n}`,
      slideIndex: f.slideIndex,
      spec: f.table,
    });
  }
  return out;
}
