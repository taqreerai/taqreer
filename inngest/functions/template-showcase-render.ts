// Render the 3 brand-showcase PNGs for a Template.
//
// Triggered by `inngest.send({ name: "template.showcase.render", … })`
// from POST /api/projects/[id]/save-as-template once the Template row
// has been written. The function loads Template.brand (a BrandSnapshot
// validated against BrandSnapshotSchema), builds the 3-slide showcase
// HTML via `buildShowcaseHtml` (cover + typography + palette — the
// 4th layout slide was retired 2026-05-22), drives Puppeteer to
// screenshot each slide individually, resizes + re-encodes via
// `sharp` (PNG → WebP at THUMBNAIL_WIDTH_PX wide, quality 82),
// uploads to the public `slide-previews` bucket, and writes the
// resulting URL list back to Template.thumbnailUrls in slide-id order.
//
// Mirrors thumbnail-render.ts deliberately so the two pipelines share
// the same operational characteristics (concurrency cap, retries,
// fonts-ready waiting, doc-coord clip math, sharp encode). Keep the
// two in lockstep — a divergence in Chromium handling between
// thumbnail-render and showcase-render would surface as inconsistent
// rendering between a project's tile and the template that came out
// of it.
//
// Storage path: `${supabaseUserId}/templates/${templateId}/${slideId}.webp`
//   The `templates/` segment keeps template renders cleanly separated
//   from project renders inside the same user prefix (which keeps
//   per-user RLS / quota policies simple).
//
// Idempotency: event `id` is `template-showcase:${templateId}` so a
// double-fire (caller retries / Inngest at-least-once delivery) does
// not produce two parallel renders.
//
// Failure isolation: fire-and-forget from the save route. The
// Template row exists with thumbnailUrls=[] until this completes;
// the /templates page treats empty thumbnailUrls as "rendering" and
// shows a placeholder tile in the meantime.

import { inngest } from "@/inngest/client";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { BrandSnapshotSchema } from "@/lib/template/derive-brand";
import {
  buildShowcaseHtml,
  SHOWCASE_SLIDE_IDS,
} from "@/lib/template/build-showcase-html";

const BUCKET = "slide-previews";
// Same width / quality knobs as thumbnail-render — keeps template
// tiles visually consistent with project tiles on the same dashboard.
const THUMBNAIL_WIDTH_PX = 800;
const THUMBNAIL_QUALITY = 82;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;

export const templateShowcaseRender = inngest.createFunction(
  {
    id: "template-showcase-render",
    name: "Render template brand showcase",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "template.showcase.render" }],
  },
  async ({ event, step, logger }) => {
    const { templateId } = event.data as { templateId: string };
    if (!templateId) {
      throw new Error("template-showcase-render: event missing templateId");
    }

    // ─── Step 1: load + validate brand snapshot ─────────────────────
    const ctx = await step.run("load-template-brand", async () => {
      const { prisma } = await import("@/lib/prisma");
      const tpl = await prisma.template.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          title: true,
          brand: true,
          owner: { select: { supabaseUserId: true } },
        },
      });
      if (!tpl) throw new Error(`Template ${templateId} not found`);
      const supabaseUserId = tpl.owner.supabaseUserId;
      if (!supabaseUserId) {
        throw new Error(
          `Template ${templateId} owner has no supabaseUserId`,
        );
      }
      const parsed = BrandSnapshotSchema.safeParse(tpl.brand);
      if (!parsed.success) {
        throw new Error(
          `Template.brand failed BrandSnapshotSchema validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      return { supabaseUserId, brand: parsed.data, title: tpl.title };
    });

    // ─── Step 2: render + upload all 3 showcase slides ──────────────
    const showcaseUrls = await step.run("render-and-upload", async () => {
      const html = buildShowcaseHtml(ctx.brand, ctx.title);
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        ctx.brand.format,
      );
      const admin = createSupabaseAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      try {
        const page = await browser.newPage();
        // Single-slide viewport + 1 px pad — same recipe as
        // thumbnail-render. See its comments for why (Chromium's
        // 16,384 px screenshot ceiling on long decks).
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
          deviceScaleFactor: 1,
        });
        await page.setContent(html, {
          waitUntil: ["domcontentloaded", "networkidle0"],
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        });
        // Webfonts may settle after networkidle0; document.fonts.ready
        // is the actual signal. Without this the typography slide
        // captures the system fallback instead of the brand's webfont,
        // which is the whole point of that slide.
        await page.evaluate(() => {
          const docFonts = (document as Document & {
            fonts?: { ready?: Promise<unknown> };
          }).fonts;
          return docFonts?.ready ?? Promise.resolve();
        });

        const urls: string[] = [];
        for (const slideId of SHOWCASE_SLIDE_IDS) {
          // Document-coord clip — see thumbnail-render for the
          // coord-space gotcha that bit us on 2026-05-21. tl;dr:
          // getBoundingClientRect is viewport-relative, but
          // page.screenshot({ clip }) reads doc-relative; add
          // scrollX/Y to bridge them.
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
            throw new Error(
              `Showcase slide ${slideId} not found in rendered document`,
            );
          }
          const png = await page.screenshot({ type: "png", clip: bbox });
          const webp = await sharp(Buffer.from(png))
            .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
            .webp({ quality: THUMBNAIL_QUALITY })
            .toBuffer();

          const path = `${ctx.supabaseUserId}/templates/${templateId}/${slideId}.webp`;
          const { error: uploadError } = await admin.storage
            .from(BUCKET)
            .upload(path, webp, {
              contentType: "image/webp",
              upsert: true,
            });
          if (uploadError) {
            throw new Error(
              `Upload failed for ${path}: ${uploadError.message}`,
            );
          }
          const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
          urls.push(data.publicUrl);
        }
        return urls;
      } finally {
        await browser.close().catch((err) => {
          logger.warn("template-showcase-render: browser.close failed", { err });
        });
      }
    });

    // ─── Step 3: write URLs back to Template ────────────────────────
    await step.run("write-showcase-urls", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.template.update({
        where: { id: templateId },
        data: { thumbnailUrls: showcaseUrls },
      });
    });

    return { templateId, slideCount: showcaseUrls.length };
  },
);
