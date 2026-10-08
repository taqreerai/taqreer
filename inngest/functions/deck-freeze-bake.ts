// FREEZE BAKE for FRAME decks (context/frame-architecture-2026-07-10.md).
//
// Triggered by `deck.freeze.bake` - from deck-generate right after save
// (non-images decks), from deck-images-generate after its reconcile commits
// (images decks; the ordering avoids a lost-update race on the slideJson
// blob), and from deck-regenerate-partial after a slide regen.
//
// THE LOOP (2026-07-10, vision revision rework - this is the product's
// fidelity core):
//
//   1. load-manifest       pending = frame slides with no bake marker
//   2. observe-and-revise  ONE clean render: measure (audit) + photograph
//                          (downscaled shots) every pending slide, then ONE
//                          vision call - the model reviews the RENDERED
//                          slides exactly as the user sees them, alongside
//                          its own code and the measured findings, and
//                          re-emits corrections via data-revises. Claude has
//                          eyes here; this is where revisions earn their cost.
//   3. freeze-and-write    render the corrected deck once, regression-guard
//                          each revision (re-audit; worse than the original
//                          = revert), freeze-in-place + self-verify + pixel
//                          gate, then ONE dual-store write. Every pending
//                          slide leaves this step FINAL: frozen html, or
//                          flow html stamped data-tq-audited (kept-flow).
//                          No afterfix chain - the loop terminates in one run.
//   4. finalize            re-render thumbnails when revisions landed +
//                          broadcast deck.baked (clients swap slides in
//                          place and clear the draft chips).
//
// TRUST GATES, outermost to innermost:
//   - vision revisions are advisory: parse failure, API failure, or an "OK"
//     reply all degrade to plain freezing. The bake never depends on the
//     model call succeeding.
//   - regression guard: a revised slide that audits WORSE than its original
//     is reverted (the model's round is spent; the original keeps flowing).
//   - freeze self-verify + pixel gate (flow vs frozen render): a slide
//     failing either keeps its flow html - viewer identical, editor takes
//     the degraded-but-lossless path.
//   - bake-vs-edit write guard: a slide whose stored html changed since
//     step 1 (a user edit landed mid-bake) is skipped entirely - the bake
//     must never clobber an edit.
//
// TOKEN DISCIPLINE (the call is API-billed):
//   - ONE vision call per bake, whole deck in one conversation.
//   - shots downscaled to <=1152px long edge JPEG (~1k tokens each vs ~2.2k
//     for the raw canvas).
//   - per-slide code is the WELL only; the shared deck stylesheet rides
//     once; system prompt is the generation prompt verbatim (prompt-cache
//     shared across calls and decks).
//   - anti-churn rules + an "OK" fast path keep output tokens at zero when
//     the deck holds up.
//
// Spike numbers (2026-07-10, scratchpad/frame-gen): worst slide 0.014% pixel
// diff; serialize-reload roundtrip 0.000%.

import sharp from "sharp";
import { Prisma } from "@prisma/client";
import type { Page } from "puppeteer";
import { inngest } from "@/inngest/client";
import {
  launchGuardedBrowser,
  closeGuardedBrowser,
  guardPageEgress,
} from "@/lib/export/puppeteer-pool";
import {
  SlideManifestSchema,
  dimensionsForFormat,
  GENCHAT_MAX,
  type GenChatEntry,
  type SlideManifest,
} from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { FREEZE_SCRIPT } from "@/lib/deck/freeze-script";
import { FIT_SCRIPT, type FitCompressResult } from "@/lib/deck/fit-script";
import { LEADING_NORMALIZE_SCRIPT } from "@/lib/deck/leading-normalize";
import {
  AUDIT_SCRIPT,
  type FrameAuditFinding,
  type FrameAuditResult,
} from "@/lib/deck/audit-script";
import {
  samplePixelContrast,
  measurePixelContrast,
  backstopInk,
} from "@/lib/deck/pixel-contrast";
import {
  frameSystemPrompt,
  frameSystemCss,
  frameVisionUserBlocks,
  frameCtxFromStoredCover,
  extractStoredWell,
  extractStoredSectionTag,
  parseFrameSlide,
  parseFrameRevises,
  assembleFramedSlide,
  type FrameVisionSlideInput,
} from "@/lib/deck/frame";
import { buildSlideHtml, canvasFrameCss } from "@/lib/deck/scaffold";
import {
  injectImgSrc,
  neutralizeGenImages,
  scanGenImages,
} from "@/lib/images/slide-images";
import { appendGenChat } from "@/lib/deck/genchat-store";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";
import { stripTextDashes } from "@/lib/deck/strip-dashes";
import { frameKindFor } from "@/lib/deck/frame-kind";

const SETCONTENT_TIMEOUT_MS = 60_000;
// A slide whose frozen render differs from its flow render by more than this
// fraction of pixels is REJECTED (kept on flow html). The spike measured
// 0.00014 worst-case, so 1% is a wide safety margin that still catches any
// real regression (the font-race class measured 22%).
const PIXEL_GATE = 1.0;
// Slides where the freeze LIFTED painted-container children (the grouping
// engine) gate near-zero instead: a lift is same-rect restructuring and
// must be visually LOSSLESS by construction - any real diff is damage.
// Owner-caught 2026-07-10: a lift that broke ".fcell .fn" descendant
// selectors shrank four stat numerals and slid UNDER the whole-canvas 1%
// gate (thin text strokes in small regions).
const LIFT_PIXEL_GATE = 0.15;
// Longest edge of the vision-prompt shots. 1152px keeps composition, type
// scale, and legibility judgeable at ~1k input tokens per slide; the full
// canvas would cost ~2.2k for no review benefit.
const VISION_IMAGE_EDGE = 1152;
// Output ceiling for the vision call - a ceiling, not a target ("OK" costs
// ~1 token). Bounds a rogue full-deck re-emission at roughly 10 slides.
const VISION_MAX_TOKENS = 32_000;

export const deckFreezeBake = inngest.createFunction(
  {
    id: "deck-freeze-bake",
    name: "Freeze-bake frame decks",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "deck.freeze.bake" }],
    // Retries exhausted: app-level log only. The deck stays on its flow html
    // (viewer identical, editor degraded) - never user-visible breakage. The
    // draft chips also stay (derived from the missing bake markers), which is
    // the honest signal: this deck never finalized.
    onFailure: async ({ event, error, logger }) => {
      const original = (event.data.event?.data ?? {}) as {
        projectId?: string;
        versionId?: string;
      };
      logger.warn("deck_freeze_bake_failed", {
        ...original,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  },
  async ({ event, step, logger }) => {
    const { projectId, versionId, force } = event.data as {
      projectId: string;
      versionId: string;
      // Ops escape hatch: re-attempt slides already stamped data-tq-audited
      // (e.g. after a freeze-script fix ships, to rescue kept-flow slides).
      force?: boolean;
    };
    // review=false skips the vision revision pass entirely (no render for
    // shots, no audit, no model call) - the bake goes straight to freeze +
    // gates. ENHANCE decks send this (owner decision 2026-07-11): 1:1
    // rebuilds of a source the model already saw, up to 75 slides - one
    // whole-deck review at that size costs more than the deck. Default
    // TRUE (create / social / mimic / datasheet / regen bakes / ops
    // re-bakes all review).
    const review = (event.data as { review?: boolean }).review !== false;
    if (!projectId || !versionId) {
      throw new Error("deck-freeze-bake: event missing projectId / versionId");
    }

    // ─── Step 1: load + validate the manifest ────────────────────────
    const manifest = await step.run("load-manifest", async () => {
      const { prisma } = await import("@/lib/prisma");
      // Cross-check versionId belongs to this project (same guard as
      // thumbnail-render): a bad payload must not bake another deck.
      const version = await prisma.presentationVersion.findFirst({
        where: { id: versionId, presentation: { projectId } },
        select: { slideJson: true },
      });
      if (!version) {
        throw new Error(
          `PresentationVersion ${versionId} not found OR not in project ${projectId}`,
        );
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `Manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      return parsed.data;
    });

    // Pending = frame slides with no bake outcome yet. data-tq-frozen and
    // data-tq-audited are both TERMINAL markers (idempotent under Inngest
    // retries + double dispatch); `force` re-opens audited slides only.
    const isPending = (s: { html: string }) =>
      s.html.includes("data-tq-frame") &&
      !s.html.includes("data-tq-frozen") &&
      (force ? true : !s.html.includes("data-tq-audited"));
    const pending = manifest.slides.filter(isPending);
    if (pending.length === 0) {
      return { versionId, frozen: 0, kept: 0, revised: 0, skipped: "nothing-to-bake" };
    }
    const pendingIds = pending.map((s) => s.slideId);
    const dims = dimensionsForFormat(manifest.format);
    // The review's system prompt must equal generation's (shared cache, same
    // persona): social carousels at any ratio use the social playbook.
    const projectType = await step.run("load-project-type", async () => {
      const { prisma } = await import("@/lib/prisma");
      const p = await prisma.project.findUnique({
        where: { id: projectId },
        select: { type: true },
      });
      return p?.type ?? null;
    });

    // ─── Step 2: observe (render + measure + photograph) and revise ──
    // ── GENCHAT (backend-transparency feed) ── the bake continues the
    // feed generation started (manifest.genChat): review started, the
    // vision model's LIVE summarized thinking, review outcome, per-slide
    // before/after proof. Writes go through jsonb_set targeting ONLY the
    // genChat key, so a concurrent slide edit can never be clobbered by a
    // chat tick. Handler-scoped: steps 2 AND 3 both write. Best-effort:
    // the feed must never fail a bake.
    const chatWrite = (mutate: (chat: GenChatEntry[]) => void): Promise<void> =>
      appendGenChat(projectId, versionId, mutate, (msg, meta) =>
        logger.warn(msg, meta),
      );

    const observed = await step.run("observe-and-revise", async () => {
      if (!review) {
        // Vision pass disabled for this bake (enhance): no render, no
        // audit, no model call - the freeze step renders once and gates.
        logger.info("deck_vision_skipped", {
          versionId,
          pending: pendingIds.length,
        });
        // Enhance skips the vision render, so no leading normalization here
        // either (it would need its own render); the freeze uses stored html.
        return {
          revisions: {} as Record<string, string>,
          fixWorthyBefore: {} as Record<string, number>,
          overflowPxBefore: {} as Record<string, number>,
          normalized: {} as Record<string, string>,
        };
      }
      // 2a. One clean render: audit findings + a downscaled shot per
      // pending slide. The browser closes BEFORE the model call - never
      // hold a Chrome instance across a long network wait. Tiny thumbs of
      // the SAME shots ride the GenChat review-ask entry so the user sees
      // exactly what the reviewer was sent.
      const shots = new Map<string, string>();
      const thumbs: string[] = [];
      let findings: Record<string, FrameAuditFinding[]> = {};
      // Deterministic Arabic-leading fix (crowded headlines → line-height 1.3,
      // measured-fit, never overflow). Runs BEFORE the audit so crowding is
      // already resolved: the audit stops flagging it and the vision round is
      // spent on real design issues. The normalized html (only for slides it
      // changed) becomes the base the freeze composes + freezes.
      const normalized: Record<string, string> = {};
      {
        const browser = await launchGuardedBrowser();
        try {
          let page = await openRenderedDeck(browser, manifest, dims);
          // Best-effort: a normalizer fault must NEVER fail a bake (it runs on
          // every deck). On any error, skip normalization and audit the deck
          // as-authored - the crowding finding then simply routes to the
          // vision pass as it did before.
          try {
            const normResult = await normalizeLeading(page, pendingIds);
            for (const sid of pendingIds) {
              if (normResult[sid]?.html) normalized[sid] = normResult[sid].html;
            }
            const normStats = pendingIds.reduce(
              (a, sid) => {
                a.adjusted += normResult[sid]?.adjusted ?? 0;
                a.shrunk += normResult[sid]?.shrunk ?? 0;
                return a;
              },
              { adjusted: 0, shrunk: 0 },
            );
            if (normStats.adjusted > 0)
              logger.info("deck_leading_normalized", {
                versionId,
                ...normStats,
              });
          } catch (err) {
            logger.warn("deck_leading_normalize_failed", {
              versionId,
              error: err instanceof Error ? err.message : String(err),
            });
            // A mid-loop fault can leave EARLIER slides mutated in the live
            // page while `normalized` captured nothing - the audit/shots would
            // then see mutated slides the freeze won't use. Re-render the
            // authored deck so audit + shots + freeze all agree on as-authored.
            await page.close().catch(() => undefined);
            page = await openRenderedDeck(browser, manifest, dims);
          }
          // Audit the NORMALIZED DOM (crowding is pre-fixed here).
          const auditRes = await auditSlides(
            page,
            pendingIds,
            manifest.direction,
          );
          findings = Object.fromEntries(
            pendingIds.map((sid) => [sid, auditRes[sid]?.findings ?? []]),
          );
          for (const sid of pendingIds) {
            const png = await shoot(page, sid);
            // Pixel-sampled contrast over ambiguous grounds (photo/scrim/
            // panel) - the CSS walk is blind there and the vision cannot see
            // invisible text; measure the SAME shot the reviewer gets. Merged
            // BEFORE fixWorthy/vision inputs so an invisible block is a
            // MEASURED defect the model must revise.
            const checks = auditRes[sid]?.pixelChecks ?? [];
            if (checks.length > 0) {
              const pixelFindings = await samplePixelContrast(
                png,
                dims.width,
                checks,
              );
              if (pixelFindings.length > 0) {
                findings[sid] = [...(findings[sid] ?? []), ...pixelFindings];
              }
            }
            const jpeg = await sharp(png)
              .resize({
                width: VISION_IMAGE_EDGE,
                height: VISION_IMAGE_EDGE,
                fit: "inside",
                withoutEnlargement: true,
              })
              .jpeg({ quality: 80 })
              .toBuffer();
            shots.set(sid, jpeg.toString("base64"));
            if (thumbs.length < 12) {
              const thumb = await sharp(png)
                .resize({ width: 200, fit: "inside" })
                .jpeg({ quality: 50 })
                .toBuffer();
              thumbs.push(`data:image/jpeg;base64,${thumb.toString("base64")}`);
            }
          }
        } finally {
          await closeGuardedBrowser(browser);
        }
      }
      // The review ASK, as a chat message with the sent screenshots (the
      // client renders the localized ask copy; kind "review" carries it).
      await chatWrite((chat) =>
        chat.push({ role: "user", kind: "review", thumbs, at: Date.now() }),
      );
      const fixWorthy = (fs: FrameAuditFinding[]) =>
        fs.filter(
          (f) =>
            f.type === "overflow" ||
            f.type === "anchor" ||
            f.type === "structure" ||
            f.type === "contrast" ||
            f.type === "crowding",
        ).length;
      for (const [sid, fs] of Object.entries(findings)) {
        if (fs.length > 0)
          logger.info("deck_frame_audit", {
            slideId: sid,
            findings: JSON.stringify(fs).slice(0, 500),
          });
      }

      // 2b. ONE vision call - the model reviews the rendered slides. Every
      // failure mode inside this block degrades to `revisions = {}`: the
      // bake then just freezes the deck as-is.
      const revisions: Record<string, string> = {};
      let revisedCount = 0;
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          logger.warn("deck_vision_skipped", { reason: "no-api-key" });
        } else {
          const direction = manifest.direction === "ltr" ? "ltr" : "rtl";
          const cover =
            manifest.slides.find((s) => s.html.includes('data-role="cover"')) ??
            manifest.slides[0];
          const ctx = frameCtxFromStoredCover(cover.html, direction);
          const imagesMode = manifest.slides.some((s) =>
            s.html.includes("data-genimage"),
          );
          const bySlideId = new Map(manifest.slides.map((s) => [s.slideId, s]));

          // The shared deck stylesheet, in authoring view: stored style
          // content minus the deterministic system layers (armor + frame
          // css) the model didn't write and can't change.
          const rawCss =
            /<style>([\s\S]*?)<\/style>/.exec(manifest.slides[0].html)?.[1] ??
            "";
          const deckCss = rawCss
            .split(canvasFrameCss(dims))
            .join("")
            .split(frameSystemCss(dims))
            .join("")
            .trim();

          const visionInputs: FrameVisionSlideInput[] = [];
          for (const s of pending) {
            // Feed the model the NORMALIZED html (leading already fixed) so it
            // reviews what was actually rendered + audited, and its revision
            // builds on the corrected leading instead of re-introducing it.
            const sourceHtml = normalized[s.slideId] ?? s.html;
            // Fallback for structurally-corrupt slides (the boundary regex
            // can't find the well when a malformed attribute swallowed it):
            // hand the model the raw DOM part of the stored html instead.
            // The revision rebuilds the structure by construction, so this
            // is exactly the path that HEALS such slides.
            const wellHtml =
              extractStoredWell(sourceHtml) ??
              sourceHtml.slice(sourceHtml.indexOf("</style>") + 8).slice(0, 12_000);
            const imageBase64 = shots.get(s.slideId);
            if (!wellHtml || !imageBase64) continue;
            visionInputs.push({
              position:
                manifest.slides.findIndex((x) => x.slideId === s.slideId) + 1,
              total: manifest.slides.length,
              sectionTag: extractStoredSectionTag(sourceHtml),
              wellHtml,
              findings: (findings[s.slideId] ?? []).map((f) =>
                f.type === "underfill" ? `advisory: ${f.detail}` : f.detail,
              ),
              imageBase64,
            });
          }
          if (visionInputs.length > 0) {
            const Anthropic = (await import("@anthropic-ai/sdk")).default;
            const client = new Anthropic({ apiKey });
            const stream = client.messages.stream({
              // Opus 5.5 (2026-10-02, was Opus 4.8): newer and 20% cheaper
              // per token ($4/$20 vs $5/$25). Thinking is always on for
              // this model (adaptive below) and effort is set explicitly,
              // since Opus 5.5 defaults to medium rather than high.
              model: "claude-opus-5-5",
              max_tokens: VISION_MAX_TOKENS,
              // summarized: the stream carries a user-readable reasoning
              // summary - relayed live into the GenChat feed below.
              thinking: { type: "adaptive", display: "summarized" },
              // medium: the review is the product's fidelity core, and at
              // "low" it read as a glance (owner report 2026-07-10: "so
              // fast, almost like he doesn't take time to study each
              // slide") - and low-effort reviews DID under-fix (the
              // contrast round-1 partial). Costs more thinking tokens,
              // buys real per-slide study.
              output_config: { effort: "medium" },
              system: [
                {
                  type: "text",
                  // Same string as generation for the same canvas, language,
                  // imagesMode, kind - the prompt cache is shared.
                  text: frameSystemPrompt({
                    canvas: dims,
                    language: manifest.language === "en" ? "en" : "ar",
                    imagesMode,
                    kind: frameKindFor(projectType, manifest.format),
                  }),
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: [
                {
                  role: "user",
                  content: frameVisionUserBlocks(visionInputs, deckCss),
                },
              ],
            });
            // Relay the vision model's summarized thinking into the feed,
            // throttled + non-overlapping (each tick is a jsonb_set write).
            let lastChatTick = 0;
            let chatBusy = false;
            let latestThinking = "";
            const putThinking = (text: string) => (chat: GenChatEntry[]) => {
              const last = chat[chat.length - 1];
              if (last?.role === "thinking") {
                last.text = text;
                last.at = Date.now();
              } else {
                chat.push({ role: "thinking", text, at: Date.now() });
              }
            };
            stream.on("thinking", (_delta, snapshot) => {
              latestThinking = snapshot;
              const now = Date.now();
              if (chatBusy || now - lastChatTick < 3000) return;
              lastChatTick = now;
              chatBusy = true;
              const text =
                snapshot.length > 600 ? `…${snapshot.slice(-600)}` : snapshot;
              void chatWrite(putThinking(text)).finally(() => {
                chatBusy = false;
              });
            });
            const finalMsg = await stream.finalMessage();
            // FINAL FLUSH: the throttle freezes the entry at its last tick,
            // cutting a COMPLETED thought mid-word ("...examine the cards
            // slide now. The" - owner report 2026-07-10, read as "the
            // review died"). Persist the full summary once the call ends.
            if (latestThinking) {
              await chatWrite(
                putThinking(
                  latestThinking.length > 1900
                    ? `…${latestThinking.slice(-1900)}`
                    : latestThinking,
                ),
              );
            }
            const raw = finalMsg.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { text: string }).text)
              .join("");

            // Parse corrected sections; data-revises (1-based deck position)
            // maps each to its slide. Only PENDING positions are accepted -
            // the model must not touch frozen or foreign slides.
            const { StreamingHtmlSplitter } = await import(
              "@/lib/deck/html-stream"
            );
            const splitter = new StreamingHtmlSplitter();
            const sections = [...splitter.push(raw), ...splitter.flush()];
            const pendingByPos = new Map(
              pending.map((s) => [
                manifest.slides.findIndex((x) => x.slideId === s.slideId) + 1,
                s,
              ]),
            );
            const armor = canvasFrameCss(dims);
            for (const sec of sections) {
              try {
                const revises = parseFrameRevises(sec.html);
                if (revises === null) continue;
                const target = pendingByPos.get(revises + 1);
                if (!target) continue;
                const slide = bySlideId.get(target.slideId);
                if (!slide) continue;
                // The reviewer's rewrite gets the same dash cleanup.
                const decl = parseFrameSlide(stripTextDashes(sec.html));
                let html = assembleFramedSlide(decl, ctx, revises, dims);
                // Re-wrap with the deck's scoped CSS: reuse the stored
                // slide's own style content minus the frame armor
                // (buildSlideHtml re-adds it + the tq-canvas class stamp).
                const oldCss =
                  /<style>([\s\S]*?)<\/style>/.exec(slide.html)?.[1] ?? "";
                html = buildSlideHtml(html, oldCss.split(armor).join(""), dims);
                revisions[target.slideId] = html;
                revisedCount += 1;
              } catch (err) {
                logger.warn("deck_vision_section_invalid", {
                  versionId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            // Already-generated images survive a revision: re-inject ready
            // srcs by genid (the prompt asks to preserve them, this is the
            // backstop).
            if (revisedCount > 0) {
              const { prisma } = await import("@/lib/prisma");
              const ready = await prisma.generatedImage.findMany({
                where: {
                  presentationVersionId: versionId,
                  status: "ready",
                  storageUrl: { not: null },
                  slideKey: { in: Object.keys(revisions) },
                },
                select: { genid: true, slideKey: true, storageUrl: true },
              });
              for (const r of ready) {
                const cur = revisions[r.slideKey];
                if (cur && r.storageUrl)
                  revisions[r.slideKey] = injectImgSrc(
                    cur,
                    r.genid,
                    r.storageUrl,
                  );
              }
            }
            logger.info("deck_vision_pass", {
              versionId,
              asked: visionInputs.length,
              revised: revisedCount,
              input: finalMsg.usage.input_tokens,
              output: finalMsg.usage.output_tokens,
              cache_read: finalMsg.usage.cache_read_input_tokens,
              cache_write: finalMsg.usage.cache_creation_input_tokens,
              stop_reason: finalMsg.stop_reason,
            });
            // The reviewer's PER-SLIDE VERDICT lines (the rules demand one
            // per slide - the discipline that stops rubber-stamp reviews of
            // big decks), shown verbatim in the feed, then per-slide
            // outcomes + the summary. Single write.
            const verdictText = raw
              .replace(/<section\b[\s\S]*$/i, "")
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => /^SLIDE\s+\d+\s*:/i.test(l))
              .join("\n")
              .slice(0, 1900);
            await chatWrite((chat) => {
              if (verdictText) {
                chat.push({
                  role: "assistant",
                  text: verdictText,
                  at: Date.now(),
                });
              }
              chat.push({
                role: "event",
                kind: "reviewDone",
                n: revisedCount,
                at: Date.now(),
              });
            });
          }
        }
      } catch (err) {
        logger.warn("deck_vision_failed", {
          versionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        revisions,
        fixWorthyBefore: Object.fromEntries(
          pendingIds.map((sid) => [sid, fixWorthy(findings[sid] ?? [])]),
        ) as Record<string, number>,
        // Overflow MAGNITUDE (worst px) baseline for the regression guard's
        // veto: a revision must never introduce or WORSEN overflow (content
        // clipped/lost), even when it keeps the total fix-worthy count flat and
        // the overflow COUNT flat.
        overflowPxBefore: Object.fromEntries(
          pendingIds.map((sid) => [sid, worstOverflowPx(findings[sid] ?? [])]),
        ) as Record<string, number>,
        // Leading-normalized html per changed slide — the base the freeze
        // composes + freezes (so the deterministic leading fix persists).
        normalized,
      };
    });

    // ─── Step 3: freeze the corrected deck + ONE dual-store write ────
    const result = await step.run("freeze-and-write", async () => {
      // Compose the final deck in memory: pending slides with an accepted
      // revision swap to the revised html, everything else keeps its
      // stored html.
      // Base html per slide: the leading-normalized version when the observe
      // pass changed it, else the stored html. Revisions (authored against the
      // normalized render) win over the base; a slide with neither is stored
      // unchanged.
      const composeBaseById = new Map(
        manifest.slides.map((s) => [
          s.slideId,
          observed.normalized[s.slideId] ?? s.html,
        ]),
      );
      const composed = manifest.slides.map((s) => {
        const html =
          observed.revisions[s.slideId] ?? composeBaseById.get(s.slideId)!;
        return html === s.html ? s : { ...s, html };
      });
      const composedManifest = { ...manifest, slides: composed };

      // Label the last quiet stretch (render + freeze + write has nothing
      // to narrate; unlabeled it read as "stopped mid revising").
      await chatWrite((chat) =>
        chat.push({ role: "event", kind: "finalizing", at: Date.now() }),
      );

      // Per-pending-slide FINAL html, decided inside the render session.
      const finalHtml = new Map<string, string>();
      const reverted = new Set<string>();
      // Slides the overflow backstop compressed (declared here so the
      // post-render feed write can milestone them).
      const compressedIds: string[] = [];
      let frozenCount = 0;

      const browser = await launchGuardedBrowser();
      try {
        const page = await openRenderedDeck(
          browser,
          composedManifest as SlideManifest,
          dims,
        );

        // Regression guard: re-audit REVISED slides in the corrected render.
        // A revision that measures WORSE than its original burns its round -
        // revert to the original html (kept-flow; its geometry is not in
        // this render, so it cannot freeze this run).
        const revisedIds = pendingIds.filter(
          (sid) => observed.revisions[sid] !== undefined,
        );
        // Shots for the revised slides, taken pre-freeze so the pixel-
        // contrast re-check measures what the revision actually renders;
        // reused below as the flow shots for the ones that go on to freeze
        // (no double capture - the page is unmutated in between).
        const revisedShots = new Map<string, Buffer>();
        if (revisedIds.length > 0) {
          const reAudit = await auditSlides(
            page,
            revisedIds,
            manifest.direction,
          );
          for (const sid of revisedIds) {
            revisedShots.set(sid, await shoot(page, sid));
          }
          for (const sid of revisedIds) {
            const entry = reAudit[sid];
            // Same pixel pass as observe: without it, a revision that KEEPS
            // the invisible text would re-audit cleaner than `before` (which
            // includes the pixel finding) and ship unfixed.
            const rePixel =
              entry?.pixelChecks?.length && revisedShots.has(sid)
                ? await samplePixelContrast(
                    revisedShots.get(sid)!,
                    dims.width,
                    entry.pixelChecks,
                  )
                : [];
            const after = [...(entry?.findings ?? []), ...rePixel];
            const now = after.filter(
              (f) =>
                f.type === "overflow" ||
                f.type === "anchor" ||
                f.type === "structure" ||
                f.type === "contrast" ||
                f.type === "crowding",
            ).length;
            const before = observed.fixWorthyBefore[sid] ?? 0;
            // Overflow VETO (2026-07-11): a total-count comparison let a
            // revision trade one fix-worthy finding for another of a DIFFERENT
            // type - the real bug was a crowding→overflow trade (line-height
            // fix pushed content out of the well) that kept the count flat and
            // shipped. Overflow means content clipped/LOST, never an acceptable
            // trade, so revert whenever the revision introduces or WORSENS it.
            // Compare MAGNITUDE (px), not count: a single overflow can balloon
            // (15px→200px) at the same count. OVERFLOW_SLACK absorbs jitter.
            const OVERFLOW_SLACK = 4;
            const overflowPxNow = worstOverflowPx(after);
            const overflowPxBefore = observed.overflowPxBefore[sid] ?? 0;
            if (
              now > before ||
              overflowPxNow > overflowPxBefore + OVERFLOW_SLACK
            ) {
              reverted.add(sid);
              logger.warn("deck_vision_regressed", {
                slideId: sid,
                before,
                after: now,
                overflowPxBefore,
                overflowPxNow,
              });
            }
          }
        }

        const toFreeze = pendingIds.filter((sid) => !reverted.has(sid));

        // Shared by both deterministic backstops below: one re-measure of
        // the FINAL composed state, plus the shot cache (a backstop that
        // mutates a slide invalidates its entry so later passes re-shoot).
        const preShots = revisedShots;
        const finalAudit = await auditSlides(page, toFreeze, manifest.direction);

        // ── DETERMINISTIC OVERFLOW BACKSTOP (2026-08-11) ── nothing freezes
        // with measured vertical overflow while deterministic compression
        // can fix it. The vision gets first shot at a design-quality fix;
        // the 2026-08-11 prod deck proved a revision can IMPROVE overflow
        // (194px -> 96px) yet still clip - the regression guard above only
        // vetoes WORSE, so the partial fix froze with the last table row
        // cut mid-row and the footer hidden. Same philosophy as the
        // contrast backstop below: deterministic enforcement when the model
        // doesn't deliver (fit-script.ts has the mechanism). Runs BEFORE
        // the contrast pass so pixel-check rects measure the compressed
        // layout.
        await page.evaluate(
          `${FIT_SCRIPT}; window.__tqFit = __tqCompressOverflow;`,
        );
        for (const sid of toFreeze) {
          if (worstOverflowPx(finalAudit[sid]?.findings ?? []) === 0) continue;
          const res = (await page.evaluate((id) => {
            const escaped = id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
            const sec = document
              .querySelector(`[data-slide-id="${escaped}"]`)
              ?.querySelector("section");
            const well = sec?.querySelector(":scope > .tq-well");
            if (!sec || !well) return null;
            const fit = (
              window as unknown as {
                __tqFit: (w: Element) => FitCompressResult;
              }
            ).__tqFit(well);
            return { ...fit, html: fit.changed ? sec.outerHTML : "" };
          }, sid)) as (FitCompressResult & { html: string }) | null;
          if (!res || !res.changed) continue;
          logger.info("deck_overflow_backstop", {
            slideId: sid,
            beforePx: res.beforePx,
            afterPx: res.afterPx,
            wsFactor: res.wsFactor,
            fontFactor: res.fontFactor,
          });
          // The DOM changed: the cached shot is stale (flow shot re-taken
          // below), and the composed html must carry the compression so the
          // kept-flow fallback + dual-store write ship it too.
          preShots.delete(sid);
          const ci = composed.findIndex((s) => s.slideId === sid);
          if (ci >= 0 && res.html) {
            composed[ci] = { ...composed[ci], html: res.html };
          }
          compressedIds.push(sid);
        }
        // Compression moved boxes: refresh those slides' audit entries so
        // the contrast pass samples the right rects, and surface any slide
        // that STILL clips after both floors (fixed-height driver) instead
        // of shipping silently.
        if (compressedIds.length > 0) {
          const reFit = await auditSlides(
            page,
            compressedIds,
            manifest.direction,
          );
          for (const sid of compressedIds) {
            if (reFit[sid]) finalAudit[sid] = reFit[sid];
            const residual = worstOverflowPx(reFit[sid]?.findings ?? []);
            if (residual > 0) {
              logger.warn("deck_overflow_backstop_residual", {
                slideId: sid,
                residualPx: residual,
              });
            }
          }
        }

        // ── DETERMINISTIC CONTRAST BACKSTOP (2026-07-15) ── nothing freezes
        // with measured-invisible text. The vision gets first shot at a
        // design-quality fix; the incident e2e proved a revision can rebuild
        // the layout yet KEEP the unreadable class ink (deck css is fixed),
        // and the guard's count parity (1 unfixed finding -> 1) ships it. So
        // any still-invisible box gets an explicit ink the system chose from
        // the sampled ground (backstopInk: farthest palette color, else
        // black/white by luminance). The freeze then captures the fixed ink
        // into the stored html; kept-flow slides carry it via `composed`.
        await page.evaluate(
          `${AUDIT_SCRIPT}; window.__tqFixText = __tqFixInvisibleText;`,
        );
        for (const sid of toFreeze) {
          const checks = finalAudit[sid]?.pixelChecks ?? [];
          if (checks.length === 0) continue;
          if (!preShots.has(sid)) preShots.set(sid, await shoot(page, sid));
          const measured = await measurePixelContrast(
            preShots.get(sid)!,
            dims.width,
            checks,
          );
          const invisible = measured.filter((m) => m.invisible && m.ground);
          if (invisible.length === 0) continue;
          const fixes = invisible.map((m) => ({
            x: m.check.x,
            y: m.check.y,
            w: m.check.w,
            h: m.check.h,
            ink: m.check.ink,
            color: backstopInk(m.ground!, manifest.theme.palette),
          }));
          const res = (await page.evaluate(
            (id, fxs) => {
              const escaped = id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
              const sec = document
                .querySelector(`[data-slide-id="${escaped}"]`)
                ?.querySelector("section");
              const well = sec?.querySelector(":scope > .tq-well");
              if (!sec || !well) return { fixed: 0, html: "" };
              const fixed = (
                window as unknown as {
                  __tqFixText: (w: Element, f: unknown[]) => number;
                }
              ).__tqFixText(well, fxs);
              return { fixed, html: fixed > 0 ? sec.outerHTML : "" };
            },
            sid,
            fixes,
          )) as { fixed: number; html: string };
          if (res.fixed > 0) {
            // The DOM changed: the cached shot is stale (flow shot re-taken
            // below), and the composed html must carry the fix so the
            // kept-flow fallback + dual-store write ship it too.
            preShots.delete(sid);
            const ci = composed.findIndex((s) => s.slideId === sid);
            if (ci >= 0 && res.html) {
              composed[ci] = { ...composed[ci], html: res.html };
            }
            logger.info("deck_contrast_backstop", {
              slideId: sid,
              fixed: res.fixed,
              colors: fixes.map((f) => f.color).join(","),
            });
          }
        }

        // Flow ground-truth shots for the pixel gate (unmutated slides reuse
        // the earlier shots - same render state; backstop-fixed slides were
        // invalidated above and re-shoot here).
        const flowShots = new Map<string, Buffer>();
        for (const sid of toFreeze) {
          flowShots.set(sid, preShots.get(sid) ?? (await shoot(page, sid)));
        }

        // Freeze each well in-page + stamp frozen.
        await page.evaluate(
          `${FREEZE_SCRIPT}; window.__tqFreeze = __tqFreezeWell;`,
        );
        const frozen = (await page.evaluate((ids) => {
          const out: Record<
            string,
            | { html: string; pinned: number; lifted: number; bad: unknown[] }
            | { error: string }
          > = {};
          for (const sid of ids) {
            // Defensive escape: slideIds are system-assigned (slide-N)
            // today, but the selector must never trust that.
            const escaped = sid.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
            const host = document.querySelector(`[data-slide-id="${escaped}"]`);
            const sec = host?.querySelector("section");
            const well = sec?.querySelector(".tq-well");
            if (!sec || !well) {
              out[sid] = { error: "no-well" };
              continue;
            }
            const res = (
              window as unknown as {
                __tqFreeze: (w: Element) => {
                  pinned: number;
                  lifted: number;
                  bad: unknown[];
                };
              }
            ).__tqFreeze(well);
            sec.setAttribute("data-tq-frozen", "1");
            out[sid] = {
              html: sec.outerHTML,
              pinned: res.pinned,
              lifted: res.lifted,
              bad: res.bad,
            };
          }
          return out;
        }, toFreeze)) as Record<
          string,
          | { html: string; pinned: number; lifted: number; bad: unknown[] }
          | { error: string }
        >;

        // Frozen shots + pixel gate (in-place is authoritative: the spike
        // proved the serialize-reload roundtrip is 0.000%).
        const composedById = new Map(composed.map((s) => [s.slideId, s.html]));
        for (const sid of toFreeze) {
          const f = frozen[sid];
          let accept = false;
          if (!f || "error" in f) {
            logger.warn("deck_freeze_slide_skipped", {
              slideId: sid,
              reason: f && "error" in f ? f.error : "missing",
            });
          } else if (f.bad.length > 0) {
            logger.warn("deck_freeze_selfverify_failed", {
              slideId: sid,
              mismatches: JSON.stringify(f.bad).slice(0, 500),
            });
          } else {
            const frozenShot = await shoot(page, sid);
            const flowShot = flowShots.get(sid)!;
            // removeAlpha: pin the raw buffers to exactly 3 channels - a
            // 4-channel (RGBA) screenshot would put the j += 3 walk out of
            // phase with pixel boundaries and turn the diff into noise
            // (CR PR #128).
            const [a, b] = await Promise.all([
              sharp(flowShot).removeAlpha().raw().toBuffer(),
              sharp(frozenShot).removeAlpha().raw().toBuffer(),
            ]);
            let diff = 0;
            const n = Math.min(a.length, b.length);
            for (let j = 0; j < n; j += 3) {
              if (
                Math.abs(a[j] - b[j]) > 12 ||
                Math.abs(a[j + 1] - b[j + 1]) > 12 ||
                Math.abs(a[j + 2] - b[j + 2]) > 12
              )
                diff++;
            }
            const pct = (diff / (n / 3)) * 100;
            const gate = f.lifted > 0 ? LIFT_PIXEL_GATE : PIXEL_GATE;
            if (pct > gate) {
              logger.warn("deck_freeze_pixelgate_failed", {
                slideId: sid,
                diffPct: pct.toFixed(3),
                gate,
                lifted: f.lifted,
              });
            } else {
              accept = true;
            }
          }
          if (accept && f && "html" in f) {
            finalHtml.set(sid, f.html);
            frozenCount += 1;
          } else {
            // Kept-flow: the composed html (revised or original), stamped
            // audited so the outcome is terminal.
            finalHtml.set(sid, stampAudited(composedById.get(sid)!));
          }
        }
        // Reverted revisions: fall back to the leading-normalized base (NOT
        // the raw original), so discarding a bad revision still keeps the
        // deterministic leading fix. Stamped audited; kept-flow (its geometry
        // isn't in this render, so it can't freeze this run).
        for (const sid of reverted) {
          finalHtml.set(sid, stampAudited(composeBaseById.get(sid)!));
        }
      } finally {
        await closeGuardedBrowser(browser);
      }

      // Per-slide revision milestones, text only (owner direction
      // 2026-07-10: no before/after image pairs - data-URI thumbs bloat
      // the stored manifest). Written BEFORE the final write so the
      // entries also ride into the manifest snapshot that carries the
      // terminal baked entry.
      const appliedRevised = pendingIds.filter(
        (sid) => observed.revisions[sid] !== undefined && !reverted.has(sid),
      );
      if (appliedRevised.length > 0 || compressedIds.length > 0) {
        await chatWrite((chat) => {
          for (const sid of appliedRevised) {
            const pos = manifest.slides.findIndex((x) => x.slideId === sid) + 1;
            chat.push({
              role: "event",
              kind: "reviseSlide",
              n: pos,
              at: Date.now(),
            });
          }
          // Overflow-backstop milestones: keep the feed honest about the
          // system compressing a slide the review round left clipping.
          for (const sid of compressedIds) {
            const pos = manifest.slides.findIndex((x) => x.slideId === sid) + 1;
            chat.push({
              role: "event",
              kind: "fit",
              n: pos,
              at: Date.now(),
            });
          }
        });
      }

      // ONE write, both stores, with the bake-vs-edit guard: only replace a
      // slide whose stored html is STILL what step 1 read - a user edit that
      // landed mid-bake wins, unconditionally.
      const { prisma } = await import("@/lib/prisma");
      const fresh = await prisma.presentationVersion.findUnique({
        where: { id: versionId },
        select: { slideJson: true, presentationId: true },
      });
      if (!fresh) throw new Error(`Version ${versionId} vanished pre-write`);
      const freshParsed = SlideManifestSchema.safeParse(fresh.slideJson);
      if (!freshParsed.success) {
        throw new Error("Manifest invalid at write time; not writing");
      }
      const fm = freshParsed.data;
      const baseById = new Map(manifest.slides.map((s) => [s.slideId, s.html]));
      let skippedStale = 0;
      const written = new Set<string>();
      const outSlides = fm.slides.map((s) => {
        const next = finalHtml.get(s.slideId);
        if (!next) return s;
        if (s.html !== baseById.get(s.slideId)) {
          skippedStale += 1;
          logger.warn("deck_freeze_write_skipped_stale", {
            slideId: s.slideId,
          });
          return s;
        }
        written.add(s.slideId);
        // Orphan-box guard (incident 2026-08-05): a vision revision may
        // only keep gen-boxes the slide already had — the image pipeline
        // finished before this bake (freezeAfter ordering), so a srcless
        // box the revision INTRODUCED has no row and would "load" forever.
        // Pre-existing srcless boxes (failed, retry-overlay-owned) pass
        // through untouched via the keep set.
        const preBake = new Set(
          scanGenImages(baseById.get(s.slideId) ?? "").map((m) => m.genid),
        );
        return { ...s, html: neutralizeGenImages(next, preBake) };
      });
      const reparsed = SlideManifestSchema.safeParse({
        ...fm,
        slides: outSlides,
        // Terminal feed entry, atomic with the bake markers - the client
        // fades the chat into the Layers panel on this signal.
        genChat: [
          ...(fm.genChat ?? []),
          { role: "event" as const, kind: "baked" as const, at: Date.now() },
        ].slice(-GENCHAT_MAX),
      });
      if (!reparsed.success) {
        throw new Error("Baked manifest failed validation; not writing");
      }
      await prisma.presentationVersion.update({
        where: { id: versionId },
        data: { slideJson: reparsed.data as never },
      });
      await mirrorSlideVersions(prisma, fresh.presentationId, outSlides, (id) =>
        written.has(id),
      );

      const revisedApplied = Object.keys(observed.revisions).filter(
        (sid) => written.has(sid) && !reverted.has(sid),
      );
      return {
        frozen: frozenCount,
        kept: pendingIds.length - frozenCount,
        revised: revisedApplied,
        compressed: compressedIds.filter((sid) => written.has(sid)),
        reverted: [...reverted],
        skippedStale,
      };
    });

    // ─── Step 4: finalize (thumbnails + realtime) ────────────────────
    await step.run("finalize", async () => {
      // Revisions and backstop compressions changed what the deck LOOKS
      // like - refresh the dashboard thumbnails, but only when this version
      // is the promoted one (never repaint tiles for a version the user
      // hasn't saved).
      if (result.revised.length > 0 || result.compressed.length > 0) {
        const { prisma } = await import("@/lib/prisma");
        const presentation = await prisma.presentation.findFirst({
          where: { projectId },
          select: { savedVersionId: true },
        });
        if (presentation?.savedVersionId === versionId) {
          await inngest
            .send({
              id: `thumbnails:${projectId}:${versionId}:baked`,
              name: "deck.thumbnails.render",
              data: { projectId, savedVersionId: versionId },
            })
            .catch((err) => {
              logger.warn("deck_baked_thumbnails_dispatch_failed", {
                projectId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      }
      // Pointer-only broadcast: clients fat-sync the manifest (which now
      // carries the bake markers) and the draft chips clear by derivation.
      await broadcastToProject(projectId, "deck.baked", {
        versionId,
        revisedSlideIds: result.revised,
      });
    });

    logger.info("deck_freeze_baked", {
      projectId,
      versionId,
      frozen: result.frozen,
      kept: result.kept,
      revised: result.revised.length,
      compressed: result.compressed.length,
      reverted: result.reverted.length,
      skippedStale: result.skippedStale,
    });
    return { versionId, ...result };
  },
);

// ─── render helpers ─────────────────────────────────────────────────────────

// Render a manifest in the export-grade environment and settle it: images
// loaded, fonts PAINTED (headless Chrome defers remote font fetches until
// first paint - fonts.ready can resolve vacuously with 0 faces; force a
// paint, poll until the loaded-face count is stable, then fonts.ready).
async function openRenderedDeck(
  browser: Awaited<ReturnType<typeof launchGuardedBrowser>>,
  manifest: SlideManifest,
  dims: { width: number; height: number },
): Promise<Page> {
  const html = buildHtmlDocumentServer(manifest);
  const page = await browser.newPage();
  await guardPageEgress(page);
  // +1: a clip rect EQUAL to the viewport hits a Chrome blank-output edge
  // case (see thumbnail-render.ts) - keep the viewport larger.
  await page.setViewport({
    width: dims.width,
    height: dims.height + 1,
    deviceScaleFactor: 1,
  });
  await page.setContent(html, {
    waitUntil: ["domcontentloaded", "networkidle0"],
    timeout: SETCONTENT_TIMEOUT_MS,
  });
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).map((i) =>
        i.complete
          ? Promise.resolve()
          : new Promise((r) => {
              i.onload = i.onerror = () => r(undefined);
            }),
      ),
    ),
  );
  await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
  await page.evaluate(async () => {
    let prev = "";
    let stable = 0;
    for (let i = 0; i < 100 && stable < 3; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const cur =
        document.fonts.size +
        ":" +
        Array.from(document.fonts).filter((f) => f.status === "loaded").length;
      if (cur === prev) stable++;
      else {
        stable = 0;
        prev = cur;
      }
    }
    await document.fonts.ready;
  });
  await page.evaluate(
    `new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); })`,
  );
  return page;
}

// Measure the audit findings for a set of slides in the CURRENT render.
// Includes the STRUCTURE check: the parsed DOM must still carry the frame's
// system layers as direct section children. A malformed model attribute (an
// unterminated quote in an svg path, first prod deck 2026-07-10) can swallow
// the well-close + chrome-open markup INTO the attribute at parse time - the
// chrome slots then land inside the well with their `.tq-chrome .slot` CSS
// dead. Only the real parser can see this, which is why it lives here and
// not in a regex.
async function auditSlides(
  page: Page,
  slideIds: string[],
  direction: string,
): Promise<Record<string, FrameAuditResult>> {
  await page.evaluate(`${AUDIT_SCRIPT}; window.__tqAudit = __tqAuditWell;`);
  return (await page.evaluate(
    (ids, dir) => {
      const out: Record<
        string,
        { findings: unknown[]; pixelChecks: unknown[] }
      > = {};
      for (const sid of ids) {
        const escaped = sid.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        const sec = document
          .querySelector(`[data-slide-id="${escaped}"]`)
          ?.querySelector("section");
        const well = sec?.querySelector(":scope > .tq-well");
        const chrome = sec?.querySelector(":scope > .tq-chrome");
        const res = well
          ? (
              window as unknown as {
                __tqAudit: (
                  w: Element,
                  d: string,
                ) => { findings: unknown[]; pixelChecks: unknown[] };
              }
            ).__tqAudit(well, dir)
          : { findings: [] as unknown[], pixelChecks: [] as unknown[] };
        if (sec && (!well || !chrome)) {
          res.findings.push({
            type: "structure",
            detail:
              "the slide markup is MALFORMED (likely an unterminated attribute quote swallowing the layer boundary): the " +
              (!well ? "well" : "chrome") +
              " layer is missing from the parsed DOM - re-emit the ENTIRE slide with clean, fully-quoted markup",
          });
        }
        out[sid] = res;
      }
      return out;
    },
    slideIds,
    direction,
  )) as Record<string, FrameAuditResult>;
}

// Worst overflow MAGNITUDE (px) across a slide's findings. The audit's
// overflow detail is "...extends Npx past the well edge"; the regression guard
// compares magnitude (not COUNT) so a single overflow that BALLOONS - same
// count, far worse clipping - is still vetoed. 0 when the slide has none.
function worstOverflowPx(findings: FrameAuditFinding[]): number {
  let worst = 0;
  for (const f of findings) {
    if (f.type !== "overflow") continue;
    const m = /extends (\d+)px/.exec(f.detail);
    if (m) worst = Math.max(worst, Number(m[1]));
  }
  return worst;
}

// Deterministic Arabic-leading normalization, in-page, BEFORE the audit +
// vision pass. Mutates each well's crowded headlines (raise line-height,
// measured-fit shrink, never overflow — see leading-normalize.ts), then
// captures the section's outerHTML so the change persists into the frozen
// slide (same capture mechanism the freeze uses). Returns the new html ONLY
// for slides it actually changed; an unchanged/reverted slide maps to "".
async function normalizeLeading(
  page: Page,
  slideIds: string[],
): Promise<Record<string, { html: string; adjusted: number; shrunk: number }>> {
  await page.evaluate(
    `${LEADING_NORMALIZE_SCRIPT}; window.__tqNormLead = __tqNormalizeLeadingWell;`,
  );
  return (await page.evaluate((ids) => {
    const out: Record<
      string,
      { html: string; adjusted: number; shrunk: number }
    > = {};
    for (const sid of ids) {
      const escaped = sid.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const sec = document
        .querySelector(`[data-slide-id="${escaped}"]`)
        ?.querySelector("section");
      const well = sec?.querySelector(":scope > .tq-well");
      if (!sec || !well) {
        out[sid] = { html: "", adjusted: 0, shrunk: 0 };
        continue;
      }
      const res = (
        window as unknown as {
          __tqNormLead: (w: Element) => {
            adjusted: number;
            shrunk: number;
            reverted: number;
          };
        }
      ).__tqNormLead(well);
      // Capture only when the DOM actually changed; else keep the stored html.
      out[sid] = {
        html: res.adjusted > 0 ? sec.outerHTML : "",
        adjusted: res.adjusted,
        shrunk: res.shrunk,
      };
    }
    return out;
  }, slideIds)) as Record<
    string,
    { html: string; adjusted: number; shrunk: number }
  >;
}

// Screenshot one slide's host box (scrolled into view) as a PNG buffer.
async function shoot(page: Page, slideId: string): Promise<Buffer> {
  const box = (await page.evaluate((sid) => {
    const host = document.querySelector(`[data-slide-id="${sid}"]`);
    if (!host) return null;
    host.scrollIntoView({ block: "start", inline: "start" });
    const r = host.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y + window.scrollY,
      width: r.width,
      height: r.height,
    };
  }, cssEscape(slideId))) as {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  if (!box) throw new Error(`freeze-bake: no host for ${slideId}`);
  return Buffer.from(await page.screenshot({ type: "png", clip: box }));
}

// Terminal kept-flow stamp (idempotent - force re-bakes may pass already-
// stamped html through here).
function stampAudited(html: string): string {
  if (html.includes("data-tq-audited")) return html;
  return html.replace(/<section /, '<section data-tq-audited="1" ');
}

// Same defensive CSS-attribute-selector escape as thumbnail-render.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Mirror updated slide html into each slide's CURRENT SlideVersion row (the
// dual-store rule; same pattern as the images reconcile) so Undo/History
// replay the written state. Parallel per slide - the rows are independent
// and a deck is at most a dozen slides (CR PR #127).
async function mirrorSlideVersions(
  prisma: (typeof import("@/lib/prisma"))["prisma"],
  presentationId: string,
  slides: { slideId: string }[],
  written: (slideId: string) => boolean,
): Promise<void> {
  await Promise.all(
    slides
      .filter((s) => written(s.slideId))
      .map(async (s) => {
        const state = await prisma.slideState.findUnique({
          where: {
            presentationId_slideKey: {
              presentationId,
              slideKey: s.slideId,
            },
          },
          select: { id: true, currentVersionNumber: true },
        });
        if (!state) return;
        await prisma.slideVersion.updateMany({
          where: {
            slideStateId: state.id,
            versionNumber: state.currentVersionNumber,
          },
          data: { slideJson: s as unknown as Prisma.InputJsonValue },
        });
      }),
  );
}
