// Server-only: re-inject generated-image `src`s into a manifest read straight
// from `PresentationVersion.slideJson`, so every server export (PNG / PDF)
// carries the same images the user sees live in the editor.
//
// WHY: the durable slideJson can be stale-srcless for a gen-image box whenever
// the client's flatten-on-enter + /edit persistence lands AFTER the image
// reconcile, OR a box was REGENERATED (deck-image-warm stores the new file +
// broadcasts, but writes no DB row, and no end-of-deck reconcile follows a
// regen). The live editor still shows the image (broadcast-patched + baked into
// the client `exportManifest` from `filledImages`), but any path that renders
// the raw slideJson would not:
//   • server PNG / PDF export (reads slideJson directly) → imageless pages
//   • a fresh page reload before `filledImages` is populated → imageless
//     client PPTX / HTML export + a shimmer in the editor
//
// FIX: resolve each box via `resolveGenImageFills` — the SAME two-source
// (ready DB rows + warmed storage files) resolver the live status route uses.
// This makes export identical to the live view and immune to a stale-srcless
// slideJson, a regenerated image, or a lost broadcast, regardless of ratio.
// Idempotent: a slide whose HTML already carries the src round-trips unchanged
// (injectImgSrc replaces the existing src with the identical value). Import
// prisma (via the resolver) keeps this server-only — never pull into a client
// bundle.

import { injectImgSrc, scanGenImages } from "@/lib/images/slide-images";
import { resolveGenImageFills } from "@/lib/images/resolve-fills";
import type { SlideManifest } from "@/lib/schema/slide";

export async function hydrateManifestImages(
  projectId: string,
  versionId: string,
  manifest: SlideManifest,
): Promise<SlideManifest> {
  // Scan every slide once: markers[i] = the gen boxes on slide i.
  const markersPerSlide = manifest.slides.map((s) => scanGenImages(s.html));
  const genBoxes = new Map<string, { prompt: string; ref: string | null }>();
  for (const markers of markersPerSlide) {
    for (const m of markers) {
      if (!genBoxes.has(m.genid)) {
        genBoxes.set(m.genid, { prompt: m.prompt, ref: m.ref });
      }
    }
  }
  if (genBoxes.size === 0) return manifest;

  const fills = await resolveGenImageFills({ projectId, versionId, genBoxes });
  if (fills.size === 0) return manifest;

  return {
    ...manifest,
    slides: manifest.slides.map((s, i) => {
      let html = s.html;
      let changed = false;
      for (const m of markersPerSlide[i]) {
        const url = fills.get(m.genid);
        if (url) {
          html = injectImgSrc(html, m.genid, url);
          changed = true;
        }
      }
      return changed ? { ...s, html } : s;
    }),
  };
}
