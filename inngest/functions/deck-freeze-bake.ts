// FREEZE BAKE for FRAME decks (context/frame-architecture-2026-07-10.md).
//
// Triggered by `deck.freeze.bake` — from deck-generate right after save
// (non-images decks) or from deck-images-generate after its reconcile commits
// (images decks; the ordering avoids a lost-update race on the slideJson
// blob). Renders the deck in the clean export-grade environment (fonts
// settled, scale 1, no editor CSS), runs the freeze-in-place script on each
// frame slide's well — pinning the FLOW layout to absolute boxes without
// moving or re-styling anything — and writes the frozen html back to BOTH
// stores (PresentationVersion.slideJson + the current SlideVersion rows).
//
// TRUST GATE: every slide is pixel-diffed (flow render vs frozen render) and
// self-verified (post-mutation re-measure inside the freeze script). A slide
// that fails either check keeps its flow html: the viewer renders it
// identically, and the editor takes the degraded-but-lossless path. A bake
// failure must never damage a deck — the gate refuses instead of guessing.
//
// Spike numbers (2026-07-10, scratchpad/frame-gen): worst slide 0.014% pixel
// diff; serialize-reload roundtrip 0.000%.

import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import {
  launchGuardedBrowser,
  closeGuardedBrowser,
  guardPageEgress,
} from "@/lib/export/puppeteer-pool";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { FREEZE_SCRIPT } from "@/lib/deck/freeze-script";
import { AUDIT_SCRIPT, type FrameAuditFinding } from "@/lib/deck/audit-script";
import {
  frameSystemPrompt,
  frameFixUserText,
  frameCtxFromStoredCover,
  extractStoredWell,
  extractStoredSectionTag,
  parseFrameSlide,
  parseFrameRevises,
  assembleFramedSlide,
  fillFrameTotals,
} from "@/lib/deck/frame";
import { buildSlideHtml, canvasFrameCss } from "@/lib/deck/scaffold";
import { injectImgSrc } from "@/lib/images/slide-images";

const SETCONTENT_TIMEOUT_MS = 60_000;
// A slide whose frozen render differs from its flow render by more than this
// fraction of pixels is REJECTED (kept on flow html). The spike measured
// 0.00014 worst-case, so 1% is a wide safety margin that still catches any
// real regression (the font-race class measured 22%).
const PIXEL_GATE = 1.0;

export const deckFreezeBake = inngest.createFunction(
  {
    id: "deck-freeze-bake",
    name: "Freeze-bake frame decks",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "deck.freeze.bake" }],
    // Retries exhausted: app-level log only. The deck stays on its flow html
    // (viewer identical, editor degraded) — never user-visible breakage.
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
    const { projectId, versionId } = event.data as {
      projectId: string;
      versionId: string;
    };
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

    // Only frame slides that aren't already frozen need work (idempotent
    // under Inngest retries + the double-dispatch guard id).
    const pending = manifest.slides.filter(
      (s) =>
        s.html.includes("data-tq-frame") && !s.html.includes("data-tq-frozen"),
    );
    if (pending.length === 0) {
      return { versionId, frozen: 0, rejected: 0, skipped: "nothing-to-bake" };
    }

    // ─── Step 2: render, freeze, pixel-gate (one puppeteer step) ─────
    const baked = await step.run("render-freeze-gate", async () => {
      const html = buildHtmlDocumentServer(manifest);
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        manifest.format,
      );
      const browser = await launchGuardedBrowser();
      try {
        const page = await browser.newPage();
        await guardPageEgress(page);
        // +1: a clip rect EQUAL to the viewport hits a Chrome blank-output
        // edge case (see thumbnail-render.ts) — keep the viewport larger.
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
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
        // ‼️ Headless Chrome defers remote font fetches until FIRST PAINT, so
        // fonts.ready can resolve vacuously with 0 faces loaded (measured on
        // the spike: 0 faces at ready, 45 faces 3s later — geometry then
        // shifts under the measurement). Force a paint, poll until the loaded
        // face count is stable, then fonts.ready again.
        await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
        await page.evaluate(async () => {
          let prev = "";
          let stable = 0;
          for (let i = 0; i < 100 && stable < 3; i++) {
            await new Promise((r) => setTimeout(r, 150));
            const cur =
              document.fonts.size +
              ":" +
              Array.from(document.fonts).filter((f) => f.status === "loaded")
                .length;
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

        // ── RENDER AUDIT (catch, don't guess) ── measure each pending slide
        // for the flaw classes the frame can't prevent structurally: content
        // clipped by the well, and reading-side-aligned text anchored to the
        // wrong edge (the RTL flex-end drift). Fix-worthy slides SKIP the
        // freeze this round; a one-shot self-fix pass (step below) hands the
        // findings back to the model, and the re-dispatched bake freezes the
        // corrected versions. data-tq-audited marks fix-attempted slides so
        // round 2 freezes them regardless (one round, never a loop).
        await page.evaluate(`${AUDIT_SCRIPT}; window.__tqAudit = __tqAuditWell;`);
        const audit = (await page.evaluate(
          (ids, dir) => {
            const out: Record<string, unknown[]> = {};
            for (const sid of ids) {
              const escaped = sid.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
              const well = document
                .querySelector(`[data-slide-id="${escaped}"]`)
                ?.querySelector(".tq-well");
              out[sid] = well
                ? (
                    window as unknown as {
                      __tqAudit: (w: Element, d: string) => unknown[];
                    }
                  ).__tqAudit(well, dir)
                : [];
            }
            return out;
          },
          pending.map((s) => s.slideId),
          manifest.direction,
        )) as Record<string, FrameAuditFinding[]>;
        // Cap the fix batch: the call is API-billed, and a deck-wide flaw
        // (shared CSS) rarely needs more than a few exemplars corrected.
        const flawed = pending
          .filter(
            (s) =>
              !s.html.includes("data-tq-audited") &&
              (audit[s.slideId] ?? []).some(
                (f) => f.type === "overflow" || f.type === "anchor",
              ),
          )
          .slice(0, 4)
          .map((s) => ({
            slideId: s.slideId,
            position: manifest.slides.findIndex((x) => x.slideId === s.slideId) + 1,
            findings: (audit[s.slideId] ?? [])
              .filter((f) => f.type !== "underfill")
              .map((f) => f.detail),
          }));
        const flawedIds = new Set(flawed.map((f) => f.slideId));
        for (const [sid, fs] of Object.entries(audit)) {
          if (fs.length > 0)
            logger.info("deck_frame_audit", {
              slideId: sid,
              findings: JSON.stringify(fs).slice(0, 500),
              willFix: flawedIds.has(sid),
            });
        }
        const toFreeze = pending.filter((s) => !flawedIds.has(s.slideId));

        const shoot = async (slideId: string): Promise<Buffer> => {
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
        };

        // Pass 1: flow ground-truth shots (freeze candidates only — flawed
        // slides are headed to the self-fix pass instead).
        const flowShots = new Map<string, Buffer>();
        for (const s of toFreeze) flowShots.set(s.slideId, await shoot(s.slideId));

        // Pass 2: freeze each pending slide's well in-page + stamp frozen.
        await page.evaluate(
          `${FREEZE_SCRIPT}; window.__tqFreeze = __tqFreezeWell;`,
        );
        const frozen = (await page.evaluate((ids) => {
          const out: Record<
            string,
            { html: string; pinned: number; bad: unknown[] } | { error: string }
          > = {};
          for (const sid of ids) {
            // Same defensive escape as shoot(): slideIds are system-assigned
            // (slide-N) today, but the selector must never trust that.
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
                __tqFreeze: (w: Element) => { pinned: number; bad: unknown[] };
              }
            ).__tqFreeze(well);
            sec.setAttribute("data-tq-frozen", "1");
            out[sid] = { html: sec.outerHTML, pinned: res.pinned, bad: res.bad };
          }
          return out;
        }, toFreeze.map((s) => s.slideId))) as Record<
          string,
          { html: string; pinned: number; bad: unknown[] } | { error: string }
        >;

        // Pass 3: frozen shots + pixel gate (in-place is authoritative: the
        // spike proved the serialize-reload roundtrip is 0.000%).
        const out: Record<string, string> = {};
        let rejected = 0;
        for (const s of toFreeze) {
          const f = frozen[s.slideId];
          if (!f || "error" in f) {
            rejected++;
            logger.warn("deck_freeze_slide_skipped", {
              slideId: s.slideId,
              reason: f && "error" in f ? f.error : "missing",
            });
            continue;
          }
          if (f.bad.length > 0) {
            rejected++;
            logger.warn("deck_freeze_selfverify_failed", {
              slideId: s.slideId,
              mismatches: JSON.stringify(f.bad).slice(0, 500),
            });
            continue;
          }
          const frozenShot = await shoot(s.slideId);
          const flowShot = flowShots.get(s.slideId)!;
          const [a, b] = await Promise.all([
            sharp(flowShot).raw().toBuffer(),
            sharp(frozenShot).raw().toBuffer(),
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
          if (pct > PIXEL_GATE) {
            rejected++;
            logger.warn("deck_freeze_pixelgate_failed", {
              slideId: s.slideId,
              diffPct: pct.toFixed(3),
            });
            continue;
          }
          out[s.slideId] = f.html;
        }
        return { out, rejected, total: toFreeze.length, flawed };
      } finally {
        await closeGuardedBrowser(browser);
      }
    });

    if (baked.rejected > 0) {
      logger.warn("deck_freeze_bake_partial", {
        projectId,
        versionId,
        frozen: baked.total - baked.rejected,
        rejected: baked.rejected,
      });
    }

    // ─── Step 3: write BOTH stores (the dual-store rule) ─────────────
    const written = await step.run("write-frozen", async () => {
      const frozenIds = Object.keys(baked.out);
      if (frozenIds.length === 0) return 0;
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({
        where: { id: versionId },
        select: { slideJson: true, presentationId: true },
      });
      if (!version) throw new Error(`Version ${versionId} vanished pre-write`);
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error("Manifest invalid at write time; not writing");
      }
      const m = parsed.data;
      const slides = m.slides.map((s) =>
        baked.out[s.slideId] ? { ...s, html: baked.out[s.slideId] } : s,
      );
      const reparsed = SlideManifestSchema.safeParse({ ...m, slides });
      if (!reparsed.success) {
        throw new Error("Frozen manifest failed validation; not writing");
      }
      await prisma.presentationVersion.update({
        where: { id: versionId },
        data: { slideJson: reparsed.data as never },
      });
      // Mirror into the slide's CURRENT SlideVersion row (same pattern as the
      // images reconcile) so Undo/History replay the frozen state, not a
      // pre-freeze flow snapshot.
      for (const s of slides) {
        if (!baked.out[s.slideId]) continue;
        const state = await prisma.slideState.findUnique({
          where: {
            presentationId_slideKey: {
              presentationId: version.presentationId,
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
      return frozenIds.length;
    });

    // ─── Step 4: ONE-round self-fix for audit-flawed slides ──────────
    // The model corrects its own slides (catch, don't guess): the measured
    // findings + each slide's current authoring view go back to Claude, the
    // corrected sections are re-assembled through the SAME frame pipeline,
    // written (stamped data-tq-audited so this can never loop), and a re-
    // dispatched bake freezes them. A failed/empty fix leaves the flow html
    // in place — viewer fine, editor degraded, no damage possible.
    let fixed = 0;
    if (baked.flawed.length > 0) {
      fixed = await step.run("self-fix", async () => {
        const { prisma } = await import("@/lib/prisma");
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          logger.warn("deck_frame_fix_skipped", { reason: "no-api-key" });
          return 0;
        }
        const version = await prisma.presentationVersion.findUnique({
          where: { id: versionId },
          select: { slideJson: true, presentationId: true },
        });
        if (!version) return 0;
        const parsed = SlideManifestSchema.safeParse(version.slideJson);
        if (!parsed.success) return 0;
        const m = parsed.data;
        const dims = dimensionsForFormat(m.format);
        const direction = m.direction === "ltr" ? "ltr" : "rtl";
        const cover =
          m.slides.find((s) => s.html.includes('data-role="cover"')) ??
          m.slides[0];
        const ctx = frameCtxFromStoredCover(cover.html, direction);
        const imagesMode = m.slides.some((s) =>
          s.html.includes("data-genimage"),
        );

        // Hand each flawed slide back in the model's authoring format.
        const bySlideId = new Map(m.slides.map((s) => [s.slideId, s]));
        const flawedInput = baked.flawed
          .map((f) => {
            const slide = bySlideId.get(f.slideId);
            const wellHtml = slide ? extractStoredWell(slide.html) : null;
            if (!slide || !wellHtml) return null;
            return {
              position: f.position,
              sectionTag: extractStoredSectionTag(slide.html),
              wellHtml,
              findings: f.findings,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (flawedInput.length === 0) return 0;

        const client = new Anthropic({ apiKey });
        const stream = client.messages.stream({
          model: "claude-opus-4-8",
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          system: [
            {
              type: "text",
              text: frameSystemPrompt({
                canvas: dims,
                language: m.language === "en" ? "en" : "ar",
                imagesMode,
              }),
            },
          ],
          messages: [{ role: "user", content: frameFixUserText(flawedInput) }],
        } as never);
        const finalMsg = await stream.finalMessage();
        const raw = finalMsg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");

        // Parse the corrected sections; data-revises maps each to its slide.
        const { StreamingHtmlSplitter } = await import(
          "@/lib/deck/html-stream"
        );
        const splitter = new StreamingHtmlSplitter();
        const sections = [...splitter.push(raw), ...splitter.flush()];
        const armor = canvasFrameCss(dims);
        const flawedByPos = new Map(baked.flawed.map((f) => [f.position, f]));
        const replacements = new Map<string, string>();
        for (const sec of sections) {
          const revises = parseFrameRevises(sec.html);
          if (revises === null) continue;
          const target = flawedByPos.get(revises + 1);
          if (!target) continue; // only slides we asked about
          const slide = bySlideId.get(target.slideId);
          if (!slide) continue;
          const decl = parseFrameSlide(sec.html);
          let html = assembleFramedSlide(decl, ctx, revises, dims);
          // One fix round only: the stamp makes the next bake freeze this
          // slide regardless of any remaining findings.
          html = html.replace(/<section /, '<section data-tq-audited="1" ');
          html = fillFrameTotals(html, m.slides.length);
          // Re-wrap with the deck's scoped CSS: reuse the stored slide's own
          // style content minus the frame armor (buildSlideHtml re-adds it,
          // along with the tq-canvas class stamp).
          const oldCss =
            /<style>([\s\S]*?)<\/style>/.exec(slide.html)?.[1] ?? "";
          html = buildSlideHtml(html, oldCss.split(armor).join(""), dims);
          replacements.set(target.slideId, html);
        }
        if (replacements.size === 0) {
          logger.warn("deck_frame_fix_empty", {
            versionId,
            asked: flawedInput.length,
            gotSections: sections.length,
          });
          return 0;
        }

        // Already-generated images survive the fix: re-inject ready srcs by
        // genid (the fix prompt asks to preserve them, this is the backstop).
        const ready = await prisma.generatedImage.findMany({
          where: {
            presentationVersionId: versionId,
            status: "ready",
            storageUrl: { not: null },
            slideKey: { in: [...replacements.keys()] },
          },
          select: { genid: true, slideKey: true, storageUrl: true },
        });
        for (const r of ready) {
          const cur = replacements.get(r.slideKey);
          if (cur && r.storageUrl)
            replacements.set(r.slideKey, injectImgSrc(cur, r.genid, r.storageUrl));
        }

        // Write BOTH stores (the dual-store rule), fresh read to compose.
        const fresh = await prisma.presentationVersion.findUnique({
          where: { id: versionId },
          select: { slideJson: true, presentationId: true },
        });
        if (!fresh) return 0;
        const freshParsed = SlideManifestSchema.safeParse(fresh.slideJson);
        if (!freshParsed.success) return 0;
        const fm = freshParsed.data;
        const slides = fm.slides.map((s) =>
          replacements.has(s.slideId)
            ? { ...s, html: replacements.get(s.slideId)! }
            : s,
        );
        const reparsed = SlideManifestSchema.safeParse({ ...fm, slides });
        if (!reparsed.success) {
          logger.warn("deck_frame_fix_invalid", { versionId });
          return 0;
        }
        await prisma.presentationVersion.update({
          where: { id: versionId },
          data: { slideJson: reparsed.data as never },
        });
        for (const s of slides) {
          if (!replacements.has(s.slideId)) continue;
          const state = await prisma.slideState.findUnique({
            where: {
              presentationId_slideKey: {
                presentationId: fresh.presentationId,
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
        for (const f of baked.flawed) {
          logger.info("deck_frame_fixed", {
            versionId,
            slideId: f.slideId,
            applied: replacements.has(f.slideId),
          });
        }
        return replacements.size;
      });

      // The fixed slides are unfrozen flow html — re-dispatch the bake to
      // freeze them (they carry data-tq-audited, so round 2 can never loop
      // back here). Distinct event id: the original id already fired.
      if (fixed > 0) {
        await inngest
          .send({
            id: `freeze:${projectId}:${versionId}:afterfix`,
            name: "deck.freeze.bake",
            data: { projectId, versionId },
          })
          .catch((err) => {
            logger.warn("deck_freeze_afterfix_dispatch_failed", {
              versionId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    }

    logger.info("deck_freeze_baked", {
      projectId,
      versionId,
      frozen: written,
      rejected: baked.rejected,
      fixed,
    });
    return { versionId, frozen: written, rejected: baked.rejected, fixed };
  },
);

// Same defensive CSS-attribute-selector escape as thumbnail-render.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
