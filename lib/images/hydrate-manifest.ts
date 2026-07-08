// Server-only: re-inject ready generated-image `src`s into a manifest read
// straight from `PresentationVersion.slideJson`.
//
// WHY: the durable slideJson can be stale-srcless for a gen-image box when
// the client's flatten-on-enter + /edit persistence lands AFTER the Inngest
// image reconcile — a race hit whenever a deck is opened/edited while images
// are still generating (slide 1, the auto-focused slide, is the usual
// victim). The live editor still shows the image (broadcast-patched into the
// iframe + baked into the client `exportManifest` from `filledImages`), but
// any path that renders the raw slideJson does not:
//   • server PNG / PDF export (reads slideJson directly) → imageless pages
//   • a fresh page reload before `filledImages` is populated → imageless
//     client PPTX / HTML export + a shimmer in the editor
//
// The `GeneratedImage` table is the source of truth (genid → storageUrl),
// exactly what the client bakes from `filledImages`. Re-applying it on the
// server read path makes every export format and every flow immune to a
// stale srcless slideJson, regardless of ratio. Idempotent: a slide whose
// HTML already carries the src round-trips unchanged (injectImgSrc replaces
// the existing src with the identical value). Import prisma keeps this file
// server-only — never pull it into a client bundle.

import { prisma } from "@/lib/prisma";
import { injectImgSrc } from "@/lib/images/slide-images";
import type { SlideManifest } from "@/lib/schema/slide";

export async function hydrateManifestImages(
  versionId: string,
  manifest: SlideManifest,
): Promise<SlideManifest> {
  const rows = await prisma.generatedImage.findMany({
    where: {
      presentationVersionId: versionId,
      status: "ready",
      storageUrl: { not: null },
    },
    select: { genid: true, slideKey: true, storageUrl: true },
  });
  if (rows.length === 0) return manifest;

  // Group ready URLs by slide (mirrors the reconcile step in
  // inngest/functions/deck-images-generate.ts so the two stay in lockstep).
  const bySlide = new Map<string, { genid: string; url: string }[]>();
  for (const r of rows) {
    if (!r.storageUrl) continue;
    const arr = bySlide.get(r.slideKey) ?? [];
    arr.push({ genid: r.genid, url: r.storageUrl });
    bySlide.set(r.slideKey, arr);
  }

  return {
    ...manifest,
    slides: manifest.slides.map((s) => {
      const patches = bySlide.get(s.slideId);
      if (!patches) return s;
      let html = s.html;
      for (const p of patches) html = injectImgSrc(html, p.genid, p.url);
      return { ...s, html };
    }),
  };
}
