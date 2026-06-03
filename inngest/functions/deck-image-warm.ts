// Warm-fill ONE streaming slide's reserved image box — the async,
// per-box front half of context/images.md's image fill.
//
// Fired by `deck.image.warm` from deck-generate the MOMENT a slide with a
// `data-genimage` box closes during the Claude stream — long before the
// deck finishes. So gpt-image-2 generation overlaps the rest of the stream,
// and each finished image broadcasts `slide.image.ready` so the live preview
// swaps its placeholder → the real image while the deck is still being
// written.
//
// No DB rows here: the version isn't final mid-stream. We store to the
// DETERMINISTIC path (`${projectId}/gen/${genid}-${hash}.png`, hash = prompt
// fingerprint); the end-of-deck `deck-images-generate` reconcile then ADOPTS
// these stored images (existence check → no re-bill) and seeds/persists the
// rows + manifest.
//
// "Bill at most once" is enforced at TWO layers (context/images.md §12):
//   1. Inngest `idempotency` keyed on (projectId, genid, promptHash) —
//      Inngest runs the function at most once per key per 24h, deduping
//      concurrent duplicate events AND re-fires from a deck-generate retry.
//      This closes the cross-run race a bare storage existence check can't
//      (two runs both pass the preflight, then both call the provider).
//   2. The storage existence check below — belt-and-suspenders for an event
//      that somehow lands outside the idempotency window; a stored box just
//      re-broadcasts its URL instead of re-billing.

import { inngest } from "@/inngest/client";
import { generateImageWithRetry } from "@/lib/images/gpt-image";
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
  // sha256→12hex of `prompt` (lib/images/store genImageHash). Folded into the
  // storage path AND the idempotency key so a drift's changed prompt is a
  // distinct image, never a collision with the discarded draft.
  hash: string;
};

export const deckImageWarm = inngest.createFunction(
  {
    id: "deck-image-warm",
    name: "Warm-fill a streaming slide image (gpt-image-2)",
    // One retry — a transient OpenAI/storage blip recovers; beyond that the
    // end-of-deck reconcile is the safety net for any box still empty.
    retries: 1,
    // Cross-run claim: at most ONE run per (projectId, genid, promptHash) per
    // 24h. A deck-generate retry re-emits warm events, and Inngest delivery is
    // at-least-once — without this, two runs could both pass the existence
    // preflight and both bill gpt-image-2 for the same box. The 24h window is
    // a bonus: a regen with an identical prompt reuses the stored image (the
    // reconcile adopts it) instead of re-billing. idemKey is precomputed by
    // the dispatcher so the CEL expression stays a simple field read.
    idempotency: "event.data.idemKey",
    // One box per run; cap parallel runs so a deck can't blow the OpenAI image
    // rate limit org-wide.
    concurrency: { limit: 6 },
    triggers: [{ event: "deck.image.warm" }],
  },
  async ({ event, step, logger }) => {
    const { projectId, slideKey, box } = event.data as {
      projectId: string;
      slideKey: string;
      box: WarmBox;
      idemKey: string;
    };
    if (!projectId || !slideKey || !box?.genid || !box.prompt || !box.hash) {
      return { filled: 0, skipped: 0, failed: 0 };
    }

    return await step.run("warm-fill", async () => {
      try {
        // Already stored for THIS prompt (warmed by a prior attempt, or an
        // identical-prompt box in a regen) → re-broadcast the URL, never
        // re-bill.
        if (await generatedImageExists(projectId, box.genid, box.hash)) {
          await broadcastToProject(projectId, "slide.image.ready", {
            slideKey,
            genid: box.genid,
            url: publicGeneratedImageUrl(projectId, box.genid, box.hash),
          });
          return { filled: 0, skipped: 1, failed: 0 };
        }
        const { b64 } = await generateImageWithRetry({
          prompt: box.prompt,
          aspect: box.aspect,
        });
        const url = await storeGeneratedImage({
          projectId,
          genid: box.genid,
          hash: box.hash,
          b64,
        });
        await broadcastToProject(projectId, "slide.image.ready", {
          slideKey,
          genid: box.genid,
          url,
        });
        return { filled: 1, skipped: 0, failed: 0 };
      } catch (err) {
        // A failed box stays a placeholder; the end reconcile retries it as a
        // straggler. Never fail the run for one image.
        logger.warn("deck_image_warm_failed", {
          projectId,
          slideKey,
          genid: box.genid,
          error: err instanceof Error ? err.message : String(err),
        });
        return { filled: 0, skipped: 0, failed: 1 };
      }
    });
  },
);
