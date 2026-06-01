// Warm-fill a streaming slide's reserved image boxes — the async,
// per-slide front half of context/images.md's image fill.
//
// Fired by `deck.image.warm` from deck-generate the MOMENT a slide with
// `data-genimage` boxes closes during the Claude stream — long before the
// deck finishes. So gpt-image-2 generation overlaps the rest of the
// stream, and each finished image broadcasts `slide.image.ready` so the
// live preview swaps its placeholder → the real image while the deck is
// still being written.
//
// No DB rows here: the version doesn't exist yet mid-stream. We store to
// the DETERMINISTIC path (`${projectId}/gen/${genid}.png`); the end-of-
// deck `deck-images-generate` reconcile then ADOPTS these stored images
// (existence check → no re-bill) and seeds/persists the rows + manifest.
//
// Idempotent: an Inngest retry re-checks storage first, so a box already
// stored just re-broadcasts its URL instead of re-billing gpt-image-2.

import { inngest } from "@/inngest/client";
import { generateImage } from "@/lib/images/gpt-image";
import {
  storeGeneratedImage,
  generatedImageExists,
  publicGeneratedImageUrl,
} from "@/lib/images/store";
import type { GenImageAspect } from "@/lib/images/slide-images";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

type WarmBox = {
  genid: string;
  prompt: string;
  aspect: GenImageAspect;
};

export const deckImageWarm = inngest.createFunction(
  {
    id: "deck-image-warm",
    name: "Warm-fill streaming slide images (gpt-image-2)",
    // One retry — a transient OpenAI/storage blip recovers; beyond that
    // the end-of-deck reconcile is the safety net for any box still empty.
    retries: 1,
    // Many slides fire warm events in quick succession; cap parallel runs
    // so a deck can't blow the OpenAI image rate limit org-wide. Each run
    // handles one slide's 1–2 boxes.
    concurrency: { limit: 6 },
    triggers: [{ event: "deck.image.warm" }],
  },
  async ({ event, step, logger }) => {
    const { projectId, slideKey, boxes } = event.data as {
      projectId: string;
      slideKey: string;
      boxes: WarmBox[];
    };
    if (!projectId || !slideKey || !Array.isArray(boxes) || boxes.length === 0) {
      return { filled: 0, skipped: 0, failed: 0 };
    }

    return await step.run("warm-fill", async () => {
      let filled = 0;
      let skipped = 0;
      let failed = 0;

      for (const box of boxes) {
        if (!box?.genid || !box.prompt) continue;
        try {
          // Already stored (warmed by a prior attempt) → re-broadcast the
          // URL, never re-bill.
          if (await generatedImageExists(projectId, box.genid)) {
            await broadcastToProject(projectId, "slide.image.ready", {
              slideKey,
              genid: box.genid,
              url: publicGeneratedImageUrl(projectId, box.genid),
            });
            skipped += 1;
            continue;
          }
          const { b64 } = await generateImage({
            prompt: box.prompt,
            aspect: box.aspect,
          });
          const url = await storeGeneratedImage({
            projectId,
            genid: box.genid,
            b64,
          });
          await broadcastToProject(projectId, "slide.image.ready", {
            slideKey,
            genid: box.genid,
            url,
          });
          filled += 1;
        } catch (err) {
          // A failed box stays a placeholder; the end reconcile retries it
          // as a straggler. Never fail the run for one image.
          failed += 1;
          logger.warn("deck_image_warm_failed", {
            projectId,
            slideKey,
            genid: box.genid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { filled, skipped, failed };
    });
  },
);
