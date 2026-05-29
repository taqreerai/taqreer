// Render a Template's deck PDF — the "layout" that becomes the Mimic
// flow's design reference.
//
// Triggered by `inngest.send({ name: "template.render", … })` from
// POST /api/projects/[id]/save-as-template once the Template row exists.
// The template's thumbnails are the SOURCE PROJECT's own slide images,
// copied at save time (user direction: "save the same images of the
// project") — this job only produces the PDF.
//
// It loads the source project's latest completed manifest (capped to
// MAX_TEMPLATE_SLIDES), renders a multi-page PDF (one slide per page at
// canvas dimensions, same recipe as the /export/pdf route), uploads it,
// and writes Template.pdfUrl. The PDF is later re-uploaded to the
// Anthropic Files API at template-use time to drive Mimic.
//
// Storage path: `${supabaseUserId}/templates/${templateId}/deck.pdf`.
//
// Idempotency: event `id` is `template-render:${templateId}`.
//
// Failure isolation: fire-and-forget from the save route. The Template
// row exists with pdfUrl=null until this completes; "use template"
// returns 409 until then.

import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { MAX_TEMPLATE_SLIDES } from "@/lib/template/constants";

const BUCKET = "slide-previews";

export const templateRender = inngest.createFunction(
  {
    id: "template-render",
    name: "Render template deck PDF",
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
      // NonRetriableError so Inngest stops (the row won't come back).
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
      const version = await prisma.presentationVersion.findFirst({
        where: {
          status: "completed",
          presentation: { projectId: tpl.sourceProjectId },
        },
        orderBy: { versionNumber: "desc" },
        select: { slideJson: true },
      });
      if (!version) {
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
      // Cap to the first MAX_TEMPLATE_SLIDES — the PDF mirrors the same
      // capped slice the save route used for thumbnails + slideCount.
      const manifest = {
        ...parsed.data,
        slides: parsed.data.slides.slice(0, MAX_TEMPLATE_SLIDES),
      };
      return { supabaseUserId, manifest };
    });

    // ─── Step 2: render the PDF + upload ────────────────────────────
    const pdf = await step.run("render-and-upload-pdf", async () => {
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        ctx.manifest.format,
      );
      const admin = createSupabaseAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const pdfPath = `${ctx.supabaseUserId}/templates/${templateId}/deck.pdf`;

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: canvasW,
          height: canvasH,
          deviceScaleFactor: 1,
        });
        // `printPageBreaks: true` emits @page + per-slide
        // page-break-after, so page.pdf() paginates one slide per page
        // at canvas dimensions (see the /export/pdf route).
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
        // One extra settled frame after fonts load.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        // Inches, not px — page.pdf() mis-handles px units on portrait
        // (9:16 returned 0-byte PDFs). 1 px = 1/96in.
        const pxToIn = (px: number): string => `${px / 96}in`;
        const rawPdf = await page.pdf({
          width: pxToIn(canvasW),
          height: pxToIn(canvasH),
          printBackground: true,
          displayHeaderFooter: false,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });

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
        const pdfUrl = admin.storage.from(BUCKET).getPublicUrl(pdfPath).data
          .publicUrl;
        return { pdfUrl, pdfPath };
      } finally {
        await browser.close().catch((err) => {
          logger.warn("template-render: browser.close failed", { err });
        });
      }
    });

    // ─── Step 3: write pdfUrl back to Template ──────────────────────
    // updateMany so a delete-during-render is detected via count === 0
    // (clean up the just-uploaded PDF instead of letting Inngest retry).
    await step.run("write-template-pdf", async () => {
      const { prisma } = await import("@/lib/prisma");
      const result = await prisma.template.updateMany({
        where: { id: templateId },
        data: { pdfUrl: pdf.pdfUrl },
      });
      if (result.count === 0) {
        try {
          const admin = createSupabaseAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const { error } = await admin.storage
            .from(BUCKET)
            .remove([pdf.pdfPath]);
          if (error) {
            logger.warn("template-render: orphan PDF cleanup failed", {
              templateId,
              error: error.message,
            });
          }
        } catch (err) {
          logger.warn("template-render: orphan PDF cleanup threw", {
            templateId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        throw new NonRetriableError(
          `Template ${templateId} was deleted mid-render; uploaded PDF cleaned up`,
        );
      }
    });

    return { templateId, pdf: true };
  },
);
