// Render a Template's real-deck artifacts: the multi-page PDF (the
// "layout") + the real per-slide thumbnails.
//
// Triggered by `inngest.send({ name: "template.render", … })` from
// POST /api/projects/[id]/save-as-template once the Template row exists.
// Unlike the retired brand-showcase render (which synthesised demo
// slides from Template.brand), this loads the SOURCE PROJECT's latest
// completed manifest and renders the actual deck:
//
//   1. Per-slide WebP thumbnails (real content) → Template.thumbnailUrls
//      — same recipe as thumbnail-render.ts (single-slide viewport,
//      doc-coord clip, sharp WebP encode).
//   2. A multi-page PDF, one slide per page at canvas dimensions → a
//      stored deck.pdf whose public URL lands in Template.pdfUrl — same
//      recipe as the /export/pdf route (printPageBreaks + page.pdf in
//      inches). This PDF is later re-uploaded to the Anthropic Files API
//      at template-use time to become the Mimic flow's design reference.
//
// (The two render recipes are intentionally copied from thumbnail-render
// + export/pdf rather than abstracted, matching the codebase's existing
// per-job "mirror" convention. A shared lib/export render helper is a
// reasonable future dedup once all three converge.)
//
// Storage path: `${supabaseUserId}/templates/${templateId}/…`
//   `${slideId}.webp` per slide + `deck.pdf`. The `templates/` segment
//   keeps template renders separated from project renders inside the
//   same user prefix (per-user RLS / quota policies stay simple).
//
// Idempotency: event `id` is `template-render:${templateId}` so a
// double-fire does not produce two parallel renders.
//
// Failure isolation: fire-and-forget from the save route. The Template
// row exists with thumbnailUrls=[] + pdfUrl=null until this completes;
// the /templates page treats empty thumbnailUrls as "rendering" and
// shows a placeholder tile in the meantime.

import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";

const BUCKET = "slide-previews";
// Same width / quality knobs as thumbnail-render — keeps template tiles
// visually consistent with project tiles on the same dashboard.
const THUMBNAIL_WIDTH_PX = 800;
const THUMBNAIL_QUALITY = 82;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;

// Defensive escape for CSS attribute selectors (slideId is the stable
// per-slide key, alphanumeric + hyphen in practice). Mirrors
// thumbnail-render's cssEscape.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export const templateRender = inngest.createFunction(
  {
    id: "template-render",
    name: "Render template deck artifacts (PDF + thumbnails)",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "template.render" }],
  },
  async ({ event, step, logger }) => {
    const { templateId } = event.data as { templateId: string };
    if (!templateId) {
      throw new Error("template-render: event missing templateId");
    }

    // ─── Step 1: load template + source-project manifest ────────────
    const ctx = await step.run("load-source-manifest", async () => {
      const { prisma } = await import("@/lib/prisma");
      const tpl = await prisma.template.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          sourceProjectId: true,
          owner: { select: { supabaseUserId: true } },
        },
      });
      // Template missing → owner deleted it before render pickup. Throw
      // NonRetriableError so Inngest stops (the row won't come back, and
      // a retry would orphan uploads the DELETE cleanup already ran).
      if (!tpl) {
        throw new NonRetriableError(
          `Template ${templateId} no longer exists; aborting render`,
        );
      }
      const supabaseUserId = tpl.owner.supabaseUserId;
      if (!supabaseUserId) {
        throw new NonRetriableError(
          `Template ${templateId} owner has no supabaseUserId`,
        );
      }
      if (!tpl.sourceProjectId) {
        throw new NonRetriableError(
          `Template ${templateId} has no sourceProjectId; cannot render deck`,
        );
      }
      // Pull the source project's latest COMPLETED manifest — the same
      // version the save route derived the brand from.
      const version = await prisma.presentationVersion.findFirst({
        where: {
          status: "completed",
          presentation: { projectId: tpl.sourceProjectId },
        },
        orderBy: { versionNumber: "desc" },
        select: { slideJson: true },
      });
      if (!version) {
        // Source project deleted (or its completed version gone) before
        // render pickup. Non-retriable — nothing to render.
        throw new NonRetriableError(
          `Template ${templateId} source project ${tpl.sourceProjectId} has no completed manifest`,
        );
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new NonRetriableError(
          `Source manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      return { supabaseUserId, manifest: parsed.data };
    });

    // ─── Step 2: render thumbnails + PDF, upload all ────────────────
    // Puppeteer state can't cross step boundaries, so the whole render
    // happens inside one step. Returns the artifact URLs + the storage
    // paths we wrote (so step 3 can clean them up on a delete race).
    const artifacts = await step.run("render-and-upload", async () => {
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        ctx.manifest.format,
      );
      const admin = createSupabaseAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const prefix = `${ctx.supabaseUserId}/templates/${templateId}`;
      const uploadedPaths: string[] = [];

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      try {
        const page = await browser.newPage();

        // ── 2a: per-slide thumbnails (screen layout) ──────────────
        // Single-slide viewport + 1 px pad (Chromium's 16,384 px
        // screenshot ceiling on long decks — see thumbnail-render).
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
          deviceScaleFactor: 1,
        });
        await page.setContent(buildHtmlDocumentServer(ctx.manifest), {
          waitUntil: ["domcontentloaded", "networkidle0"],
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        });
        await page.evaluate(() => {
          const docFonts = (
            document as Document & { fonts?: { ready?: Promise<unknown> } }
          ).fonts;
          return docFonts?.ready ?? Promise.resolve();
        });

        const thumbnailUrls: string[] = [];
        for (const slide of ctx.manifest.slides) {
          // Doc-coord clip — scrollIntoView keeps Chrome painting one
          // slide at a time, but getBoundingClientRect is viewport-
          // relative while page.screenshot({ clip }) reads doc coords;
          // add scrollX/Y to bridge them (see thumbnail-render).
          const bbox = await page.evaluate((escaped) => {
            const el = document.querySelector(`[data-slide-id="${escaped}"]`);
            if (!el) return null;
            el.scrollIntoView({ block: "start", inline: "start" });
            const r = el.getBoundingClientRect();
            return {
              x: r.x + window.scrollX,
              y: r.y + window.scrollY,
              width: r.width,
              height: r.height,
            };
          }, cssEscape(slide.slideId));
          if (!bbox) {
            throw new Error(
              `Slide ${slide.slideId} not found in rendered document`,
            );
          }
          const png = await page.screenshot({ type: "png", clip: bbox });
          const webp = await sharp(Buffer.from(png))
            .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
            .webp({ quality: THUMBNAIL_QUALITY })
            .toBuffer();

          const path = `${prefix}/${slide.slideId}.webp`;
          const { error: uploadError } = await admin.storage
            .from(BUCKET)
            .upload(path, webp, { contentType: "image/webp", upsert: true });
          if (uploadError) {
            throw new Error(`Upload failed for ${path}: ${uploadError.message}`);
          }
          uploadedPaths.push(path);
          thumbnailUrls.push(
            admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
          );
        }

        // ── 2b: multi-page PDF (print layout) ─────────────────────
        // `printPageBreaks: true` emits @page + per-slide
        // page-break-after, so page.pdf() paginates one slide per page
        // at canvas dimensions (see the /export/pdf route).
        await page.setViewport({
          width: canvasW,
          height: canvasH,
          deviceScaleFactor: 1,
        });
        await page.setContent(
          buildHtmlDocumentServer(ctx.manifest, { printPageBreaks: true }),
          { waitUntil: ["domcontentloaded", "networkidle2"], timeout: 30_000 },
        );
        await page.evaluate(() => {
          const docFonts = (
            document as Document & { fonts?: { ready?: Promise<unknown> } }
          ).fonts;
          return docFonts?.ready ?? Promise.resolve();
        });
        // One extra settled frame after fonts load (some Chrome builds
        // queue post-font-load layout that page.pdf would otherwise
        // capture mid-relayout).
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        // Inches, not px — page.pdf() mis-handles px units on portrait
        // (9:16 returned 0-byte PDFs, user-flagged 2026-05-21). 1 px =
        // 1/96in.
        const pxToIn = (px: number): string => `${px / 96}in`;
        const rawPdf = await page.pdf({
          width: pxToIn(canvasW),
          height: pxToIn(canvasH),
          printBackground: true,
          displayHeaderFooter: false,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });

        const pdfPath = `${prefix}/deck.pdf`;
        const { error: pdfUploadError } = await admin.storage
          .from(BUCKET)
          .upload(pdfPath, Buffer.from(rawPdf), {
            contentType: "application/pdf",
            upsert: true,
          });
        if (pdfUploadError) {
          throw new Error(
            `Upload failed for ${pdfPath}: ${pdfUploadError.message}`,
          );
        }
        uploadedPaths.push(pdfPath);
        const pdfUrl = admin.storage.from(BUCKET).getPublicUrl(pdfPath).data
          .publicUrl;

        return { thumbnailUrls, pdfUrl, uploadedPaths };
      } finally {
        await browser.close().catch((err) => {
          logger.warn("template-render: browser.close failed", { err });
        });
      }
    });

    // ─── Step 3: write artifact URLs back to Template ───────────────
    // updateMany (not update) so a missing row doesn't throw — we detect
    // deletion-during-render via count === 0 and clean up our uploads
    // instead of letting Inngest retry (which would race delete cleanup).
    await step.run("write-template-artifacts", async () => {
      const { prisma } = await import("@/lib/prisma");
      const result = await prisma.template.updateMany({
        where: { id: templateId },
        data: {
          thumbnailUrls: artifacts.thumbnailUrls,
          pdfUrl: artifacts.pdfUrl,
        },
      });
      if (result.count === 0) {
        // Template deleted between Step 1 and now. Best-effort cleanup of
        // everything Step 2 uploaded, then NonRetriableError so Inngest
        // stops retrying.
        try {
          const admin = createSupabaseAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const { error } = await admin.storage
            .from(BUCKET)
            .remove(artifacts.uploadedPaths);
          if (error) {
            logger.warn("template-render: orphan cleanup failed", {
              templateId,
              error: error.message,
            });
          }
        } catch (err) {
          logger.warn("template-render: orphan cleanup threw", {
            templateId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        throw new NonRetriableError(
          `Template ${templateId} was deleted mid-render; uploaded files cleaned up`,
        );
      }
    });

    return {
      templateId,
      thumbnailCount: artifacts.thumbnailUrls.length,
      pdf: true,
    };
  },
);
