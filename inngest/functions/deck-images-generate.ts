// Fill an images-mode deck's reserved boxes with gpt-image-2 images.
// Phase 2 of context/images.md.
//
// Fired by `deck.images.requested` from deck-generate AFTER the deck is
// saved — only when the brief had imagesMode on (isImagesMode). Decoupled
// from generation on purpose: the deck renders instantly with placeholder
// gradients, image failures never fail the deck, and this run is retried
// independently.
//
// Flow:
//   1. scan-and-seed   — load the saved manifest, scan every slide for
//                        `data-genimage` boxes, seed one GeneratedImage
//                        row per box (idempotent upsert).
//   2. generate-all    — a concurrency-capped pool: gpt-image-2 → store to
//                        the public bucket → mark the row ready/failed.
//                        Idempotent: boxes already ready are skipped, so a
//                        retry never re-bills a generated image.
//   3. reconcile       — inject each ready image's URL as the box <img>'s
//                        `src` into the durable slideJson + the seeded
//                        SlideVersion v1 snapshot, then re-fire thumbnails.
//
// Realtime progressive swap (placeholder→spinner→image) is layered on top
// in Phase 2b; this server-fill phase is verified by refresh-to-see.

import { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { SlideManifestSchema } from "@/lib/schema/slide";
import {
  scanGenImages,
  injectImgSrc,
  type GenImageAspect,
} from "@/lib/images/slide-images";
import { generateImage } from "@/lib/images/gpt-image";
import { storeGeneratedImage } from "@/lib/images/store";

// Hard ceiling on images filled per deck — mirrors the cap baked into
// SYSTEM_PROMPT_IMAGES (deck-generate). The scan can't exceed what Claude
// emitted, but this is the belt-and-suspenders cost guard.
const MAX_GENERATED_IMAGES = 12;
// Parallel gpt-image-2 calls in flight per deck. 4 keeps wall-clock low
// (~3 batches for a full 12) without hammering the OpenAI image rate
// limit; each call is ~10–30s.
const IMAGE_CONCURRENCY = 4;

type ImageBox = {
  slideKey: string;
  genid: string;
  prompt: string;
  role: string;
  aspect: GenImageAspect;
};

export const deckImagesGenerate = inngest.createFunction(
  {
    id: "deck-images-generate",
    name: "Fill deck images (gpt-image-2)",
    retries: 2,
    // Each run fans IMAGE_CONCURRENCY OpenAI calls; cap parallel runs so a
    // burst of generations can't blow the image rate limit org-wide.
    concurrency: { limit: 3 },
    triggers: [{ event: "deck.images.requested" }],
    // No onFailure user surface: generated images are decorative. A failed
    // run leaves placeholder gradients + regenerable boxes (Phase 4).
  },
  async ({ event, step, logger }) => {
    const { projectId, versionId } = event.data as {
      projectId: string;
      versionId: string;
    };
    if (!projectId || !versionId) {
      throw new Error(
        "deck-images-generate: event missing projectId / versionId",
      );
    }

    // ─── Step 1: load + scan + seed rows ────────────────────────────
    const boxes = await step.run("scan-and-seed", async () => {
      const { prisma } = await import("@/lib/prisma");
      // Cross-check the version belongs to this project (same guard as
      // thumbnail-render) so a malformed event can't fill another deck.
      const version = await prisma.presentationVersion.findFirst({
        where: { id: versionId, presentation: { projectId } },
        select: { slideJson: true },
      });
      if (!version) {
        throw new Error(
          `deck-images: version ${versionId} not found or not in project ${projectId}`,
        );
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `deck-images: manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 300)}`,
        );
      }

      // Collect boxes across slides in document order, capped.
      const collected: ImageBox[] = [];
      for (const slide of parsed.data.slides) {
        for (const marker of scanGenImages(slide.html)) {
          collected.push({ slideKey: slide.slideId, ...marker });
          if (collected.length >= MAX_GENERATED_IMAGES) break;
        }
        if (collected.length >= MAX_GENERATED_IMAGES) break;
      }

      // Seed a row per box. Idempotent under retry: `update: {}` keeps any
      // prior status/url so a re-run never resets a ready image.
      for (const b of collected) {
        await prisma.generatedImage.upsert({
          where: {
            presentationVersionId_genid: {
              presentationVersionId: versionId,
              genid: b.genid,
            },
          },
          create: {
            presentationVersionId: versionId,
            slideKey: b.slideKey,
            genid: b.genid,
            prompt: b.prompt,
            role: b.role,
            aspect: b.aspect,
            status: "pending",
          },
          update: {},
        });
      }
      logger.info("deck_images_seeded", {
        projectId,
        versionId,
        boxes: collected.length,
      });
      return collected;
    });

    if (boxes.length === 0) {
      return { boxes: 0, generated: 0, failed: 0, skipped: 0 };
    }

    // ─── Step 2: generate + store (concurrency-capped pool) ─────────
    // One step does the whole batch — the OpenAI client + its results
    // can't cross step boundaries cleanly, same constraint as
    // thumbnail-render's single Puppeteer step.
    const result = await step.run("generate-all", async () => {
      const { prisma } = await import("@/lib/prisma");
      // Retry-safe: skip boxes already filled by a prior attempt.
      const ready = await prisma.generatedImage.findMany({
        where: {
          presentationVersionId: versionId,
          status: "ready",
          storageUrl: { not: null },
        },
        select: { genid: true },
      });
      const done = new Set(ready.map((r) => r.genid));
      const todo = boxes.filter((b) => !done.has(b.genid));

      let generated = 0;
      let failed = 0;
      let cursor = 0;
      const setStatus = (genid: string, data: Prisma.GeneratedImageUpdateInput) =>
        prisma.generatedImage.update({
          where: {
            presentationVersionId_genid: {
              presentationVersionId: versionId,
              genid,
            },
          },
          data,
        });

      const worker = async () => {
        // `cursor++` is atomic between awaits (single-threaded JS), so
        // workers in THIS run never pull the same box. The DB claim below
        // guards the cross-run case (Inngest replay / a concurrent retry).
        while (cursor < todo.length) {
          const b = todo[cursor++];
          // Atomic claim (compare-and-set): flip to "generating" ONLY from a
          // not-yet-claimed status. A concurrent replay/retry that already
          // claimed this box matches 0 rows here and skips, so generateImage()
          // — the billed provider call — runs at most once per box. A box left
          // stuck "generating" by a hard crash is the accepted trade (it just
          // ends imageless, same as a "failed" box); caught errors set
          // "failed" below, which is re-claimable on the next attempt.
          const claim = await prisma.generatedImage.updateMany({
            where: {
              presentationVersionId: versionId,
              genid: b.genid,
              status: { notIn: ["ready", "generating"] },
            },
            data: { status: "generating" },
          });
          if (claim.count === 0) continue;
          try {
            const { b64, size } = await generateImage({
              prompt: b.prompt,
              aspect: b.aspect,
            });
            const url = await storeGeneratedImage({
              projectId,
              genid: b.genid,
              b64,
            });
            await setStatus(b.genid, {
              status: "ready",
              storageUrl: url,
              size,
            });
            generated += 1;
          } catch (err) {
            failed += 1;
            logger.warn("deck_image_failed", {
              versionId,
              genid: b.genid,
              error: err instanceof Error ? err.message : String(err),
            });
            await setStatus(b.genid, { status: "failed" }).catch(() => undefined);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(IMAGE_CONCURRENCY, todo.length) }, () =>
          worker(),
        ),
      );
      return { generated, failed, skipped: done.size };
    });

    // ─── Step 3: reconcile slideJson + SlideVersion v1, re-thumbnail ─
    await step.run("reconcile-manifest", async () => {
      const { prisma } = await import("@/lib/prisma");
      const rows = await prisma.generatedImage.findMany({
        where: {
          presentationVersionId: versionId,
          status: "ready",
          storageUrl: { not: null },
        },
        select: { genid: true, slideKey: true, storageUrl: true },
      });
      if (rows.length === 0) return; // nothing filled → leave placeholders

      const version = await prisma.presentationVersion.findUnique({
        where: { id: versionId },
        select: { slideJson: true, presentationId: true },
      });
      if (!version) return;
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error("deck-images reconcile: manifest failed validation");
      }
      const manifest = parsed.data;

      // Group ready URLs by slide.
      const bySlide = new Map<string, { genid: string; url: string }[]>();
      for (const r of rows) {
        if (!r.storageUrl) continue;
        const arr = bySlide.get(r.slideKey) ?? [];
        arr.push({ genid: r.genid, url: r.storageUrl });
        bySlide.set(r.slideKey, arr);
      }

      const patchedSlides = manifest.slides.map((s) => {
        const patches = bySlide.get(s.slideId);
        if (!patches) return s;
        let html = s.html;
        for (const p of patches) html = injectImgSrc(html, p.genid, p.url);
        return { ...s, html };
      });

      const reparsed = SlideManifestSchema.safeParse({
        ...manifest,
        slides: patchedSlides,
      });
      if (!reparsed.success) {
        throw new Error(
          "deck-images reconcile: patched manifest failed validation",
        );
      }

      // Durable: the renderer + export read slideJson directly.
      await prisma.presentationVersion.update({
        where: { id: versionId },
        data: { slideJson: reparsed.data as never },
      });

      // Keep the seeded per-slide snapshot in sync so an Undo back to the
      // current version doesn't drop the freshly-filled image. Only the
      // patched slides need it; target the SlideVersion the slide's
      // pointer currently sits on (v1 for a fresh generation).
      const presentationId = version.presentationId;
      for (const s of patchedSlides) {
        if (!bySlide.has(s.slideId)) continue;
        const state = await prisma.slideState.findUnique({
          where: {
            presentationId_slideKey: {
              presentationId,
              slideKey: s.slideId,
            },
          },
          select: { id: true, currentVersionNumber: true },
        });
        if (!state) continue;
        await prisma.slideVersion.updateMany({
          where: {
            slideStateId: state.id,
            versionNumber: state.currentVersionNumber,
          },
          data: { slideJson: s as unknown as Prisma.InputJsonValue },
        });
      }

      // Re-render thumbnails so dashboard tiles show the filled deck, not
      // the placeholder gradients the save-time render captured. Only when
      // THIS version is the saved one (first generation auto-saves it);
      // a regen of a non-saved version leaves the saved thumbnails alone.
      // Distinct dedup id so it isn't suppressed by the save-time render.
      const presentation = await prisma.presentation.findUnique({
        where: { id: presentationId },
        select: { savedVersionId: true },
      });
      if (presentation?.savedVersionId === versionId) {
        await inngest
          .send({
            id: `thumbnails:${projectId}:${versionId}:images`,
            name: "deck.thumbnails.render",
            data: { projectId, savedVersionId: versionId },
          })
          .catch((err) => {
            logger.warn("deck_images_thumbnail_refire_failed", {
              versionId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }

      logger.info("deck_images_reconciled", {
        projectId,
        versionId,
        filled: rows.length,
      });
    });

    return { boxes: boxes.length, ...result };
  },
);
