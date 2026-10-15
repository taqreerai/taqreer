// Enhance phase 1, step 2 (docs/enhance-visuals-plan.md): at generation time,
// find the original pictures of a PPTX upload, store them in the private
// `source-assets` bucket under the project, and return the small manifest the
// prompt and the server-side enforcement need (no bytes: it rides an Inngest
// step result).
//
// Every slide's pictures are stored, not only the visible ones of a free-plan
// teaser, so an unlock later can place them too (the raw upload itself is
// purged after 24h by source-files-cleanup). PDF uploads return no pictures
// for now (phase 2).

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extractPptxVisuals, classifyPptxPictures } from "@/lib/extract/pptx-visuals";
import { buildPptxAssets } from "@/lib/extract/pptx-asset-crops";
import { uploadSourceAsset } from "@/lib/storage/source-assets";

const SOURCE_FILES_BUCKET = "source-files";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
// Upload concurrency: small files, a few at a time.
const UPLOAD_PARALLEL = 4;

export type CarriedPicture = {
  assetId: string;
  slideIndex: number; // presentation order, 0-based
  cls: "content" | "small";
  aspect: number; // width / height on the original slide
  altText: string | null;
};

export type CarriedPictures = {
  // Per-file AI images rule (owner, 2026-10-15): any CONTENT picture in the
  // file switches AI images off for the whole deck.
  hasContentImages: boolean;
  pictures: CarriedPicture[];
  // Pictures found but not storable here (EMF / WMF / undecodable): left to
  // the existing photo-slot handling until page crops land.
  skipped: number;
};

export async function prepareCarriedPictures(opts: {
  projectId: string;
  sourcePath: string;
  sourceMime: string;
}): Promise<CarriedPictures> {
  if (opts.sourceMime !== PPTX_MIME) return { hasContentImages: false, pictures: [], skipped: 0 };

  const { data, error } = await getSupabaseAdmin().storage.from(SOURCE_FILES_BUCKET).download(opts.sourcePath);
  if (error || !data) throw new Error(`carried pictures: source not found at ${opts.sourcePath}`);
  const buffer = Buffer.from(await data.arrayBuffer());

  const visuals = await extractPptxVisuals(buffer);
  const classes = classifyPptxPictures(visuals);
  const hasContentImages = [...classes.values()].includes("content");
  const assets = await buildPptxAssets(buffer, visuals, classes);

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
  };
}
