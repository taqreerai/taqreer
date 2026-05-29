// Render a Template's preview thumbnails + deck PDF.
//
// Triggered by `inngest.send({ name: "template.render", … })` from
// POST /api/projects/[id]/save-as-template once the Template row exists.
//
// The template's 3-slide preview composition (user direction):
//   slide 1 — the source project's REAL cover image (its own thumbnail)
//   slide 2 — a typography/font showcase rendered from the brand
//   slide 3 — a palette showcase rendered from the brand
// plus a multi-page deck PDF (capped to MAX_TEMPLATE_SLIDES) that is
// re-uploaded to the Anthropic Files API at use-time to drive Mimic.
//
// Storage: `${supabaseUserId}/templates/${templateId}/…`
//   `showcase-02-typography.webp`, `showcase-03-palette.webp`, `deck.pdf`
//   (the cover is referenced from the project's own storage, not copied).
//
// Idempotency: event `id` is `template-render:${templateId}`.
// Failure isolation: fire-and-forget; pdfUrl=null + brand-only preview
// until this completes.

import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { BrandSnapshotSchema } from "@/lib/template/derive-brand";
import { buildShowcaseHtml } from "@/lib/template/build-showcase-html";
import { renderDeckPdf } from "@/lib/export/render-deck-pdf";
import { MAX_TEMPLATE_SLIDES } from "@/lib/template/constants";

const BUCKET = "slide-previews";
const THUMBNAIL_WIDTH_PX = 800;
const THUMBNAIL_QUALITY = 82;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;
// The two showcase slides we render (slide 1 is the project's own
// cover image). IDs match build-showcase-html's data-slide-id values.
const SHOWCASE_RENDER_IDS = [
  "showcase-02-typography",
  "showcase-03-palette",
] as const;

export const templateRender = inngest.createFunction(
  {
    id: "template-render",
    name: "Render template preview + deck PDF",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "template.render" }],
  },
  async ({ event, step, logger }) => {
    const { templateId } = event.data as { templateId: string };
    if (!templateId) {
      throw new Error("template-render: event missing templateId");
    }

    // ─── Step 1: load template brand + source-project cover + manifest
    const ctx = await step.run("load-source", async () => {
      const { prisma } = await import("@/lib/prisma");
      const tpl = await prisma.template.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          title: true,
          brand: true,
          sourceProjectId: true,
          owner: { select: { supabaseUserId: true } },
        },
      });
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
          `Template ${templateId} has no sourceProjectId; cannot render`,
        );
      }
      const brandParsed = BrandSnapshotSchema.safeParse(tpl.brand);
      if (!brandParsed.success) {
        throw new NonRetriableError(
          `Template.brand failed validation: ${JSON.stringify(brandParsed.error.issues).slice(0, 300)}`,
        );
      }
      const project = await prisma.project.findUnique({
        where: { id: tpl.sourceProjectId },
        select: { thumbnailUrls: true },
      });
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
          `Template ${templateId} source project has no completed manifest`,
        );
      }
      const manifestParsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!manifestParsed.success) {
        throw new NonRetriableError(
          `Source manifest failed validation: ${JSON.stringify(manifestParsed.error.issues).slice(0, 300)}`,
        );
      }
      return {
        supabaseUserId,
        title: tpl.title,
        brand: brandParsed.data,
        // The project's own slide images (cover first). Composed with
        // the showcase slides below.
        projectThumbs: project?.thumbnailUrls ?? [],
        manifest: {
          ...manifestParsed.data,
          slides: manifestParsed.data.slides.slice(0, MAX_TEMPLATE_SLIDES),
        },
      };
    });

    // ─── Step 2: render showcase slides + PDF, upload everything ────
    const artifacts = await step.run("render-and-upload", async () => {
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        ctx.brand.format,
      );
      const admin = createSupabaseAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const prefix = `${ctx.supabaseUserId}/templates/${templateId}`;
      const uploadedPaths: string[] = [];

      // 2a — typography + palette showcase screenshots.
      const showcaseUrls: string[] = [];
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
          deviceScaleFactor: 1,
        });
        await page.setContent(buildShowcaseHtml(ctx.brand, ctx.title), {
          waitUntil: ["domcontentloaded", "networkidle0"],
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        });
        await page.evaluate(() => {
          const docFonts = (
            document as Document & { fonts?: { ready?: Promise<unknown> } }
          ).fonts;
          return docFonts?.ready ?? Promise.resolve();
        });
        for (const slideId of SHOWCASE_RENDER_IDS) {
          const bbox = await page.evaluate((id) => {
            const el = document.querySelector(`[data-slide-id="${id}"]`);
            if (!el) return null;
            el.scrollIntoView({ block: "start", inline: "start" });
            const r = el.getBoundingClientRect();
            return {
              x: r.x + window.scrollX,
              y: r.y + window.scrollY,
              width: r.width,
              height: r.height,
            };
          }, slideId);
          if (!bbox) {
            throw new Error(`Showcase slide ${slideId} not found`);
          }
          const png = await page.screenshot({ type: "png", clip: bbox });
          const webp = await sharp(Buffer.from(png))
            .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
            .webp({ quality: THUMBNAIL_QUALITY })
            .toBuffer();
          const path = `${prefix}/${slideId}.webp`;
          const { error: upErr } = await admin.storage
            .from(BUCKET)
            .upload(path, webp, { contentType: "image/webp", upsert: true });
          if (upErr) {
            throw new Error(`Upload failed for ${path}: ${upErr.message}`);
          }
          uploadedPaths.push(path);
          showcaseUrls.push(
            admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
          );
        }
      } finally {
        await browser.close().catch((err) => {
          logger.warn("template-render: browser.close failed", { err });
        });
      }

      // 2b — deck PDF (the Mimic reference).
      const pdfPath = `${prefix}/deck.pdf`;
      const pdfBytes = await renderDeckPdf(ctx.manifest);
      const { error: pdfUpErr } = await admin.storage
        .from(BUCKET)
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (pdfUpErr) {
        throw new Error(`Upload failed for ${pdfPath}: ${pdfUpErr.message}`);
      }
      uploadedPaths.push(pdfPath);
      const pdfUrl = admin.storage.from(BUCKET).getPublicUrl(pdfPath).data
        .publicUrl;

      // Compose: [cover, typography, palette, ...rest of the project's
      // real slides], capped at MAX_TEMPLATE_SLIDES. Cover = the
      // project's first slide; rest = the slides after it.
      const cover = ctx.projectThumbs[0] ?? null;
      const rest = ctx.projectThumbs.slice(1);
      const thumbnailUrls = [cover, ...showcaseUrls, ...rest]
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .slice(0, MAX_TEMPLATE_SLIDES);
      return { thumbnailUrls, pdfUrl, uploadedPaths };
    });

    // ─── Step 3: write thumbnails + pdfUrl back ─────────────────────
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
          `Template ${templateId} was deleted mid-render; uploads cleaned up`,
        );
      }
    });

    return { templateId, thumbnailCount: artifacts.thumbnailUrls.length };
  },
);
