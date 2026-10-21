// deck.unlock.requested → author the WITHHELD teaser tail on Opus (comped).
//
// Teaser paywall (free-tier conversion): a free deck was authored as a complete
// `total`-slide arc but only the first `visibleCount` slides were streamed - the
// rest withheld as a blurred, locked teaser. When the owner subscribes, the
// unlock endpoint fires this: it authors the withheld slides (positions
// visibleCount+1 .. total) as net-new frame slides that COMPLETE the arc, on
// Opus, and splices them into a fresh PresentationVersion. The 5 originals stay
// frozen; the fresh slides run through the same freeze/vision bake generation
// gives every slide. No credit hold/settle - the unlock is the conversion
// reward, comped.
//
// Reuses the partial-regen assembly recipe (frame contract, shared deck css
// recovery, buildSlideHtml) so the tail can't drift from the deck's look. No
// image-model call: net-new slides use no background image (consistent with a
// non-images FRAME deck), so the frost's promise holds without gpt-image cost.

import { toSdkThinking } from "@/lib/anthropic/model-thinking";
import Anthropic from "@anthropic-ai/sdk";
import { isEmptySlideHtml, readLockedPages, type LockedPage } from "@/lib/deck/locked-pages";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  SLIDE_DIMENSIONS,
  SLIDE_ROLE_VALUES,
  SlideManifestSchema,
  type SlideFormat,
  type SlideManifest,
  type SlideType,
} from "@/lib/schema/slide";
import { ensureFresh } from "@/lib/config/runtime-config";
import { paramsForQuality, usesLayoutRules } from "@/lib/anthropic/quality-params";
import { scopeDeckCss, unscopeDeckCss } from "@/lib/deck/scope-css";
import { buildSlideHtml, canvasFrameCss } from "@/lib/deck/scaffold";
import {
  assembleFramedSlide,
  extractStoredSectionTag,
  extractStoredWell,
  frameContinuationUserMessage,
  frameCtxFromStoredCover,
  frameSystemCss,
  frameSystemPrompt,
  parseFrameSlide,
} from "@/lib/deck/frame";
import { allocateNextVersionInTx, retryOnP2002 } from "@/lib/api/regen-helpers";
import { stripTextDashes } from "@/lib/deck/strip-dashes";
import {
  collectSeedableGenImages,
  neutralizeGenImages,
} from "@/lib/images/slide-images";
import { frameKindFor } from "@/lib/deck/frame-kind";
import {
  CARRIED_PICTURES_RULE,
  CARRIED_TABLES_RULE,
  CARRIED_CHARTS_RULE,
  carriedSlideBlock,
  enforceCarriedAssetImgs,
  enforceCarriedTables,
  applyPageBackdrop,
  type CarriedPictureRef,
  type CarriedTableRef,
} from "@/lib/deck/carried-assets";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the runtime environment");
  }
  return new Anthropic({ apiKey });
}

type UnlockEvent = {
  projectId: string;
  presentationId: string;
  sourceVersionId: string;
  lockedCount: number;
  quality?: string | null;
  jobId?: string | null;
  actorPrismaUserId?: string | null;
  tier?: string | null;
};

// onFailure wraps the original event under `.event.data`.
function readOriginalEvent(eventData: unknown): Partial<UnlockEvent> {
  if (!eventData || typeof eventData !== "object") return {};
  const inner = (eventData as { event?: { data?: unknown } }).event?.data;
  if (!inner || typeof inner !== "object") return {};
  return inner as Partial<UnlockEvent>;
}

const VALID_ROLES = new Set<string>(SLIDE_ROLE_VALUES);

export const deckUnlock = inngest.createFunction(
  {
    id: "deck-unlock",
    name: "Unlock Teaser Slides",
    // 1 retry (same cost shape as generate/regen): a retry re-runs the Opus
    // authoring call, so cap re-burns at 2x.
    retries: 1,
    concurrency: [
      { key: "event.data.actorPrismaUserId", limit: 2 },
      // 5 = the Inngest free-plan account concurrency cap.
      { limit: 5 },
    ],
    priority: { run: "event.data.tier == 'max' ? 120 : 0" },
    triggers: [{ event: "deck.unlock.requested" }],
    // Terminal failure: mark the unlock Job failed so a reload-then-retry can
    // re-dispatch (the in-flight guard only blocks queued/processing/running).
    // teaserUnlockedAt is left null, so the deck stays a teaser and the owner
    // can try again. Best-effort.
    onFailure: async ({ event }) => {
      const original = readOriginalEvent(event.data);
      if (!original.jobId) return;
      await prisma.job
        .update({ where: { id: original.jobId }, data: { status: "failed" } })
        .catch((e) => console.error("deck-unlock onFailure: job write failed", e));
    },
  },
  async ({ event, step, logger }) => {
    const data = event.data as UnlockEvent;
    const { projectId, presentationId, sourceVersionId } = data;
    const lockedCount = Math.max(0, Math.floor(Number(data.lockedCount) || 0));

    // ── 1. Load the source manifest (visible slides + theme) + raw brief ──
    const source = await step.run("load-source-manifest", async () => {
      const version = await prisma.presentationVersion.findUnique({
        where: { id: sourceVersionId },
        select: { slideJson: true },
      });
      if (!version) {
        throw new NonRetriableError(`Source version ${sourceVersionId} not found`);
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new NonRetriableError(
          `Source manifest invalid: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      // The brief (topic/content) lives alongside the manifest on the version
      // row, not inside SlideManifestSchema - read it raw for continuity.
      const rawBrief = (version.slideJson as { brief?: unknown } | null)?.brief;
      return { manifest: parsed.data, rawBrief: rawBrief ?? null };
    });

    const manifest = source.manifest;
    const isFrameDeck = manifest.slides.some((s) => s.html.includes("data-tq-frame"));

    // Nothing valid to author (not a frame deck, empty, or 0 locked): flip the
    // flag so the client stops waiting, mark the job done, and exit cleanly.
    if (!isFrameDeck || lockedCount <= 0 || manifest.slides.length === 0) {
      await step.run("mark-unlocked-noop", async () => {
        await prisma.project
          .update({ where: { id: projectId }, data: { teaserUnlockedAt: new Date() } })
          .catch(() => undefined);
        if (data.jobId) {
          await prisma.job
            .update({ where: { id: data.jobId }, data: { status: "succeeded" } })
            .catch(() => undefined);
        }
      });
      logger.info("deck_unlock_noop", { projectId, isFrameDeck, lockedCount });
      return { authored: 0 };
    }

    const format: SlideFormat = manifest.format ?? "16:9";
    const dims = SLIDE_DIMENSIONS[format];
    // Social carousels (any ratio) keep the social playbook for the tail.
    const projectType = await step.run("load-project-type", async () => {
      const p = await prisma.project.findUnique({
        where: { id: projectId },
        select: { type: true },
      });
      return p?.type ?? null;
    });
    const visibleCount = manifest.slides.length;
    const total = visibleCount + lockedCount;

    // Shared deck css in authoring view: slide[0]'s stored <style> minus the
    // deterministic system layers - the exact recipe partial-regen + the bake
    // use, so the tail's look never depends on the model reproducing rules.
    const sourceStyle =
      /<style>([\s\S]*?)<\/style>/.exec(manifest.slides[0]?.html ?? "")?.[1] ?? "";
    const sourceDeckCss = sourceStyle
      .split(canvasFrameCss(dims))
      .join("")
      .split(frameSystemCss(dims))
      .join("")
      .trim();

    const frameCtx = frameCtxFromStoredCover(
      (
        manifest.slides.find((s) => s.html.includes('data-role="cover"')) ??
        manifest.slides[0]
      ).html,
      manifest.direction === "ltr" ? "ltr" : "rtl",
    );
    // An images-mode deck carries data-genimage boxes on its visible slides.
    // The unlocked tail matches: author image backgrounds, then fill them via
    // the same deck.images.requested pipeline generation uses (which adopts the
    // already-filled boxes on slides 1-N by genid+hash and generates only the
    // new tail's boxes). A non-images deck keeps the imageless path.
    const isImagesDeck = manifest.slides.some((s) =>
      s.html.includes("data-genimage"),
    );
    const systemPrompt = frameSystemPrompt({
      canvas: dims,
      language: manifest.language === "en" ? "en" : "ar",
      imagesMode: isImagesDeck,
      kind: frameKindFor(projectType, format),
      // The Haiku tail (region-limited buyers) gets the same rules as its head.
      layoutRules: usesLayoutRules(data.quality ?? "opus-fast"),
    });
    const briefText = source.rawBrief
      ? // 40k chars (was 6k, 2026-10-05): the teaser now covers every flow,
        // and an enhance / datasheet / mimic brief carries the WHOLE source,
        // whose later pages are exactly what the locked tail must use.
        JSON.stringify(source.rawBrief).slice(0, 40000)
      : manifest.title;

    // Enhance: the user's own pictures and tables of the LOCKED slides (owner
    // rule 2026-10-15, docs/enhance-visuals-plan.md). Generation stored them in
    // the private bucket and saved which belongs to which slide on its Job; the
    // raw upload itself may be purged by now. Enhance keeps one slide per
    // source slide, so source slide i is deck position i.
    const carried = await step.run("load-carried-assets", async () => {
      const jobs = await prisma.job.findMany({
        where: { projectId, type: "deck.generate" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { inputJson: true },
      });
      // Enhance redesign text: every source slide's exact words live on the
      // generation job's brief (the durable home; the raw upload is purged).
      let redesignSources: { position: number; text: string }[] = [];
      for (const j of jobs) {
        const src = (j.inputJson as { brief?: { source?: { kind?: string; textPerSlide?: unknown } } } | null)?.brief?.source;
        if (src?.kind !== "enhance" || !Array.isArray(src.textPerSlide)) continue;
        const texts = src.textPerSlide as unknown[];
        redesignSources = [];
        for (let idx = visibleCount; idx < total; idx++) {
          const t = texts[idx];
          redesignSources.push({ position: idx + 1, text: typeof t === "string" ? t.slice(0, 6000) : "" });
        }
        break;
      }
      for (const j of jobs) {
        const c = (j.inputJson as { carried?: { pictures?: CarriedPictureRef[]; tables?: CarriedTableRef[] } } | null)?.carried;
        if (!c) continue;
        const inTail = (slideIndex: number) => slideIndex >= visibleCount && slideIndex < total;
        return {
          pictures: (c.pictures ?? []).filter((x) => inTail(x.slideIndex)),
          tables: (c.tables ?? []).filter((x) => inTail(x.slideIndex)),
          redesignSources,
        };
      }
      return { pictures: [] as CarriedPictureRef[], tables: [] as CarriedTableRef[], redesignSources };
    });
    // Enhance teaser: the locked source pages kept at generation (PDF uploads
    // have no per-slide text, so these pages ARE the content).
    const lockedPages = await step.run("load-locked-pages", async () => {
      const jobs = await prisma.job.findMany({
        where: { projectId, type: "deck.generate" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { inputJson: true },
      });
      for (const j of jobs) {
        const lp = (j.inputJson as { lockedPages?: LockedPage[] } | null)?.lockedPages;
        if (Array.isArray(lp) && lp.length > 0) {
          return lp.filter((p) => p.position > visibleCount && p.position <= total);
        }
      }
      return [] as LockedPage[];
    });
    const carriedBlock = (() => {
      if (carried.pictures.length === 0 && carried.tables.length === 0) return "";
      const blocks: string[] = [];
      for (let idx = visibleCount; idx < total; idx++) {
        const b = carriedSlideBlock(
          idx + 1,
          projectId,
          carried.pictures.filter((x) => x.slideIndex === idx),
          carried.tables.filter((x) => x.slideIndex === idx),
        );
        if (b) blocks.push(b);
      }
      return [
        "",
        "THE USER'S OWN PICTURES AND TABLES for the slides you author (from their uploaded deck):",
        ...(carried.tables.length > 0 ? [CARRIED_TABLES_RULE] : []),
        ...(carried.tables.some((x) => "kind" in x.spec) ? [CARRIED_CHARTS_RULE] : []),
        ...(carried.pictures.length > 0 ? [CARRIED_PICTURES_RULE] : []),
        "",
        ...blocks,
      ].join("\n");
    })();
    // Page-sized artworks are shown only as a slide's backdrop (data-bg-asset),
    // never as a well picture: kept out of the well map (an <img> of one is removed).
    const carriedAssets = new Map(
      carried.pictures.filter((x) => x.cls !== "page" && x.cls !== "backdrop").map((x) => [x.assetId, x.aspect] as const),
    );
    const carriedPageIds = new Set(carried.pictures.filter((x) => x.cls === "page").map((x) => x.assetId));
    const carriedOriginals = new Map(
      carried.pictures.flatMap((x) => (x.originalAssetId ? [[x.assetId, x.originalAssetId] as const] : [])),
    );
    const carriedBackdropIds = new Set(carried.pictures.filter((x) => x.cls === "backdrop").map((x) => x.assetId));
    const pageAssetAt = new Map(
      carried.pictures.filter((x) => x.cls === "page").map((x) => [x.slideIndex, x.assetId] as const),
    );
    const carriedTables = new Map(carried.tables.map((x) => [x.tableId, x.spec] as const));
    if (carriedBlock) {
      logger.info("deck_unlock_carried", {
        projectId,
        pictures: carried.pictures.length,
        tables: carried.tables.length,
        redesign: carried.redesignSources.length > 0,
      });
    }

    // ── 2. Author the withheld tail (one Opus call, N sections) ──
    const rawReply = await step.run("author-continuation", async () => {
      await ensureFresh();
      const callParams = paramsForQuality(data.quality ?? "opus-fast");
      const existingSlides = manifest.slides.map((s, i) => ({
        position: i + 1,
        sectionTag: extractStoredSectionTag(s.html),
        wellHtml: (extractStoredWell(s.html) ?? "").slice(0, 6000),
      }));
      const continuation = frameContinuationUserMessage(
        {
          visibleCount,
          total,
          lockedCount,
          deckTitle: frameCtx.deckTitle,
          brief: briefText,
          existingSlides,
          // Enhance: redesign each locked source slide with its exact words.
          ...(carried.redesignSources.length > 0 ? { redesignSources: carried.redesignSources } : {}),
        },
        sourceDeckCss,
      );
      const textMessage = carriedBlock ? `${continuation}\n${carriedBlock}` : continuation;
      const pageImages = lockedPages.length > 0 ? await readLockedPages(projectId, lockedPages) : [];
      const userMessage: Anthropic.Messages.ContentBlockParam[] | string =
        pageImages.length > 0
          ? [
              {
                type: "text",
                text:
                  "The ORIGINAL source slides you redesign are attached below as images, one per locked position. " +
                  "Each image is the authoritative content of that slide: when its text block is empty or shorter, " +
                  "read the slide's words from the image and reproduce them exactly (same language, same order, nothing invented, nothing dropped).",
              },
              ...pageImages.flatMap((p) => [
                { type: "text" as const, text: `SOURCE SLIDE ${p.position} (your slide ${p.position}):` },
                { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: p.base64 } },
              ]),
              { type: "text", text: textMessage },
            ]
          : textMessage;
      const client = getClient();
      // STREAM (not create): a non-streaming call at this max_tokens trips the
      // SDK's ">10 minute operation" guard. finalMessage() still returns the
      // whole assembled message, so downstream parsing is unchanged. Matches
      // how deck-generate authors the full deck.
      const message = await client.messages
        .stream({
          model: callParams.model,
          // Enough headroom for ~5 authored slides; well under the ceiling.
          max_tokens: Math.min(callParams.maxTokens ?? 64000, 64000),
          thinking: toSdkThinking(callParams.thinking),
          system: [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          ...(callParams.outputConfig ? { output_config: callParams.outputConfig } : {}),
          messages: [{ role: "user", content: userMessage }],
        })
        .finalMessage();
      logger.info("deck_unlock_usage", {
        projectId,
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cache_read: message.usage.cache_read_input_tokens,
      });
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text block in unlock response");
      }
      return textBlock.text;
    });

    // ── 3. Split into sections + assemble through the frame contract ──
    const sections = rawReply.match(/<section\b[\s\S]*?<\/section>/gi) ?? [];
    if (sections.length === 0) {
      throw new Error("Unlock reply contained no <section> elements");
    }
    const newSlides: SlideType[] = sections.slice(0, lockedCount).map((raw, i) => {
      const slideIndex = visibleCount + i; // 0-based deck position
      // Strip any bake markers the model copied off its references: a fresh
      // slide arriving pre-frozen would false-skip the freeze bake's review.
      const noMarkers = raw.replace(
        /\sdata-tq-(?:frozen|audited)(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/g,
        "",
      );
      const extraCss: string[] = [];
      const noStyles = noMarkers.replace(
        /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
        (_m, css: string) => {
          // Contract forbids a <style> block; if the model emits one, keep its
          // rules (scoped) rather than dropping them.
          extraCss.push(scopeDeckCss(unscopeDeckCss(css)));
          return "";
        },
      );
      // House style: no em/en dashes (lib/deck/strip-dashes.ts).
      // Carried pictures / tables: canonical links, exact tables, nothing
      // foreign (lib/deck/carried-assets.ts), same as generation's ingest.
      const decl = parseFrameSlide(
        enforceCarriedTables(
          enforceCarriedAssetImgs(stripTextDashes(noStyles), projectId, carriedAssets, carriedOriginals),
          carriedTables,
        ),
      );
      applyPageBackdrop(decl, projectId, carriedPageIds, pageAssetAt.get(slideIndex), carriedBackdropIds);
      const assembled = assembleFramedSlide(decl, frameCtx, slideIndex, dims);
      const html = buildSlideHtml(
        assembled,
        `${frameSystemCss(dims)}\n${sourceDeckCss}${
          extraCss.length ? `\n${extraCss.join("\n")}` : ""
        }`,
        dims,
      );
      const role = VALID_ROLES.has(decl.role)
        ? (decl.role as NonNullable<SlideType["role"]>)
        : undefined;
      return {
        slideId: `slide-${slideIndex + 1}`,
        ...(role ? { role } : {}),
        html,
      };
    });

    // Orphan-box guard (incident 2026-08-05): the tail may only carry
    // srcless data-genimage boxes the deck.images.requested dispatch below
    // will actually seed — the doc-order capped walk over the FULL spliced
    // deck (the originals' boxes consume cap slots first, mirroring the
    // seed scan). A non-images deck never dispatches, so every authored
    // box is stripped to its static placeholder gradient; on an images
    // deck the overflow past the cap is. Prevents forever-"loading" boxes
    // no pipeline owns.
    {
      const seedable = isImagesDeck
        ? collectSeedableGenImages([...manifest.slides, ...newSlides])
        : null;
      for (let i = 0; i < newSlides.length; i += 1) {
        const s = newSlides[i];
        const html = neutralizeGenImages(s.html, seedable?.get(s.slideId));
        if (html !== s.html) newSlides[i] = { ...s, html };
      }
    }

    // Never save an empty unlock (2026-10-20: 25 slides holding a page number,
    // job "succeeded", payment kept). Fail instead: the deck stays locked and
    // the owner's paid unlock can be retried at no charge.
    {
      const empty = newSlides.filter((s) => isEmptySlideHtml(s.html)).length;
      if (empty >= Math.max(2, Math.ceil(newSlides.length * 0.2))) {
        logger.error("deck_unlock_empty_slides", { projectId, empty, authored: newSlides.length, pages: lockedPages.length });
        throw new Error(`unlock authored ${empty} of ${newSlides.length} slides with no content`);
      }
    }

    // ── 4. Splice into a fresh version + stamp teaserUnlockedAt ──
    const saved = await step.run("save-unlocked-version", async () => {
      const candidate: SlideManifest = {
        version: manifest.version,
        presentationId: manifest.presentationId,
        title: manifest.title,
        language: manifest.language,
        direction: manifest.direction,
        format: manifest.format,
        theme: manifest.theme,
        slides: [...manifest.slides, ...newSlides],
      };
      // Never persist model output without a Zod check (inngest/** guideline).
      const parsed = SlideManifestSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(
          `Unlocked manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      const newManifest = parsed.data;
      return retryOnP2002(() =>
        prisma.$transaction(async (tx) => {
          const version = await allocateNextVersionInTx(
            tx,
            presentationId,
            sourceVersionId,
          );
          await tx.presentationVersion.update({
            where: { id: version.id },
            data: { slideJson: newManifest as never, status: "completed" },
          });
          // The saved pin moves too (2026-10-08): the first generation
          // auto-saved the teaser version, and the PNG / PDF exports, the
          // dashboard thumbnail and the library all read savedVersionId
          // first, so leaving it behind exported only the visible slides.
          // Unlocking is a whole-deck action the owner asked for. Left null
          // when nothing was ever saved (readers then use currentVersionId).
          const pres = await tx.presentation.findUnique({
            where: { id: presentationId },
            select: { savedVersionId: true },
          });
          await tx.presentation.update({
            where: { id: presentationId },
            data: {
              currentVersionId: version.id,
              ...(pres?.savedVersionId ? { savedVersionId: version.id } : {}),
            },
          });
          // teaserUnlockedAt flips here: the viewer's unlock poll swaps the
          // 10-slide manifest in and drops the locked slots.
          await tx.project.update({
            where: { id: projectId },
            data: { status: "completed", teaserUnlockedAt: new Date() },
          });
          return version;
        }),
      );
    });

    // ── 5. Finalize the fresh (unfrozen) slides. Images decks fill the tail's
    // gpt-image boxes first (deck-images-generate adopts the already-filled
    // originals by genid+hash and generates only the new boxes, then chains the
    // freeze bake via freezeAfter); non-images decks bake straight away. The
    // bake's pending filter picks up exactly the new slides; the frozen
    // originals are skipped. Best-effort: a failed dispatch must not fail an
    // unlock whose slides are already saved. ──
    await step.run("dispatch-finalize", async () => {
      try {
        if (isImagesDeck) {
          await inngest.send({
            id: `images:${projectId}:${saved.id}:unlock:${data.jobId ?? event.id ?? "0"}`,
            name: "deck.images.requested",
            data: { projectId, versionId: saved.id, freezeAfter: true, review: true },
          });
        } else {
          await inngest.send({
            id: `freeze:${projectId}:${saved.id}:unlock:${data.jobId ?? event.id ?? "0"}`,
            name: "deck.freeze.bake",
            data: { projectId, versionId: saved.id, review: true },
          });
        }
      } catch (err) {
        logger.warn("deck_unlock_finalize_dispatch_failed", {
          projectId,
          versionId: saved.id,
          imagesMode: isImagesDeck,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    if (data.jobId) {
      await step.run("mark-job-succeeded", async () => {
        await prisma.job
          .update({ where: { id: data.jobId! }, data: { status: "succeeded" } })
          .catch(() => undefined);
      });
    }

    return { authored: newSlides.length, versionId: saved.id };
  },
);
