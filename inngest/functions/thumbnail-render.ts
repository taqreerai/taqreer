// Render slide thumbnails for the saved version of a deck.
//
// Triggered by `inngest.send({ name: "deck.thumbnails.render", … })`
// from POST /api/projects/[id]/save once the canonical version
// pointer has been pinned. The function loads the saved manifest,
// renders it to a standalone HTML document (via the server-side
// html-document-server helper — same template the live preview /
// download path uses, just sanitised in JSDOM instead of `window`),
// drives Puppeteer to screenshot each slide individually, resizes +
// re-encodes via `sharp` (PNG → WebP at THUMBNAIL_WIDTH_PX wide,
// quality 82), uploads to the public `slide-previews` bucket, and
// writes the resulting URL list back to Project.thumbnailUrls in
// the SAME order as manifest.slides[].
//
// Storage path: `${userId}/${projectId}/${savedVersionId}/${slideKey}.webp`
//   userId → Supabase user UUID (matches the brand-assets convention
//     so per-user storage policies stay consistent).
//   savedVersionId → versioned dir so we never overwrite the previous
//     save's thumbnails until the new save commits. Storage cleanup
//     of obsolete dirs is intentionally out-of-scope (step 8 is
//     about getting thumbnails on screen; GC is a later concern).
//
// Concurrency: capped at 2 in-flight renders org-wide because each
// run launches a Chromium instance (~200 MB). Two parallel saves are
// fine; ten saves would OOM the worker.
//
// Idempotency: Inngest deduplicates events sharing the same `id`
// within a short window. The caller (save route) constructs
// `${projectId}:${savedVersionId}` so a double-click on the Save
// button doesn't queue two identical renders.
//
// Failure isolation: this is fire-and-forget from the caller's
// perspective — a failed render must NOT block the Save round-trip.
// `onFailure` logs the error context for debugging but doesn't
// surface a user-facing notification yet (no project lifecycle UI
// expects "thumbnails failed" today; step 9 dashboard rework will
// gracefully fall back to placeholder tiles when thumbnailUrls
// is empty).

import { inngest } from "@/inngest/client";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import {
  launchGuardedBrowser,
  closeGuardedBrowser,
  guardPageEgress,
} from "@/lib/export/puppeteer-pool";
import sharp from "sharp";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { CONTRAST_CHECK_SCRIPT, type ContrastViolation } from "@/lib/deck/contrast-check";

const BUCKET = "slide-previews";
// 800 px wide balances three usage points: dashboard tiles (~300 px),
// retina dashboards (~600 px), and an inline lightbox without
// pulling the full PNG. WebP quality 82 keeps each thumbnail near
// 30–80 KB; 90+ doubles file size for marginal perceived gain.
const THUMBNAIL_WIDTH_PX = 800;
const THUMBNAIL_QUALITY = 82;
// Puppeteer page.setContent network-wait budget. Webfonts via
// fonts.googleapis.com sometimes settle slowly behind the corporate
// network; cap at 15 s so a flaky font CDN doesn't hang the worker.
const NETWORK_IDLE_TIMEOUT_MS = 15_000;

export const thumbnailRender = inngest.createFunction(
  {
    id: "thumbnail-render",
    name: "Render slide thumbnails",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "deck.thumbnails.render" }],
  },
  async ({ event, step, logger }) => {
    const { projectId, savedVersionId } = event.data as {
      projectId: string;
      savedVersionId: string;
    };
    if (!projectId || !savedVersionId) {
      throw new Error(
        "thumbnail-render: event missing projectId / savedVersionId",
      );
    }

    // ─── Step 1: load + validate the saved manifest ─────────────────
    const ctx = await step.run("load-saved-manifest", async () => {
      const { prisma } = await import("@/lib/prisma");
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          user: { select: { supabaseUserId: true } },
        },
      });
      if (!project) throw new Error(`Project ${projectId} not found`);
      const supabaseUserId = project.user.supabaseUserId;
      if (!supabaseUserId) {
        throw new Error(`Project ${projectId} owner has no supabaseUserId`);
      }
      // Validate savedVersionId BELONGS to this projectId. Without
      // the cross-check, a malformed event payload (or upstream
      // bug) could point us at another deck's version row and the
      // pipeline would render thumbnails for the wrong project +
      // upload them to THIS project's storage path. The `findFirst`
      // joins through `presentation.projectId` so a version from a
      // different project resolves to null → throw.
      const version = await prisma.presentationVersion.findFirst({
        where: {
          id: savedVersionId,
          presentation: { projectId },
        },
        select: { slideJson: true },
      });
      if (!version) {
        throw new Error(
          `PresentationVersion ${savedVersionId} not found OR doesn't belong to project ${projectId} (save ordering bug or cross-project event)?`,
        );
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `Saved manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      return { supabaseUserId, manifest: parsed.data };
    });

    // ─── Step 2: render + upload all thumbnails ─────────────────────
    // Puppeteer state can't cross step boundaries (each step.run is
    // a separate process in production), so we do the entire render
    // loop inside a single step. The step result is the list of URLs.
    const thumbnailUrls = await step.run("render-and-upload", async () => {
      const html = buildHtmlDocumentServer(ctx.manifest);
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        ctx.manifest.format,
      );
      const admin = createSupabaseAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const browser = await launchGuardedBrowser();
      try {
        const page = await browser.newPage();
        await guardPageEgress(page);
        // Viewport sized to a SINGLE slide + 1 px pad. The earlier
        // `canvasH * (slides+1)` recipe crossed Chromium's hard
        // 16,384 px screenshot limit on long decks — at 9:16 that
        // happens at >7 slides; at 16:9 at >14 slides — producing
        // blank thumbnails or crashing the print pipeline.
        // We now scroll each slide into view before clipping (see
        // the per-slide loop below). The +1 pad keeps viewport
        // strictly larger than any single-slide clip rect, dodging
        // Chrome's clip-equals-viewport blank-output edge case.
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
          deviceScaleFactor: 1,
        });
        await page.setContent(html, {
          waitUntil: ["domcontentloaded", "networkidle0"],
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        });
        // Webfonts load asynchronously even after networkidle0 settles
        // because `document.fonts.ready` resolves on a separate clock.
        // Wait for both before screenshotting; otherwise the first
        // thumbnail captures fallback fonts and the rest catch the
        // real ones, producing visually inconsistent runs.
        await page.evaluate(() => {
          const docFonts = (document as Document & {
            fonts?: { ready?: Promise<unknown> };
          }).fonts;
          return docFonts?.ready ?? Promise.resolve();
        });

        // ── Contrast guard (phase 1: detect-only, 2026-06-12) ──
        // One walk over the already-rendered deck; logs invisible-text
        // candidates (computed color ≈ effective solid background) so
        // we can measure frequency before any auto-fix. Never throws -
        // a guard failure must not cost the user their thumbnails.
        try {
          const violations = (await page.evaluate(CONTRAST_CHECK_SCRIPT)) as ContrastViolation[];
          if (violations.length > 0) {
            logger.warn("deck_contrast_violations", {
              projectId,
              count: violations.length,
              items: violations,
            });
          }
        } catch (err) {
          logger.warn("deck_contrast_check_failed", {
            projectId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const urls: string[] = [];
        for (const slide of ctx.manifest.slides) {
          // Resolve the slide's on-page bbox so we can clip
          // explicitly. Element-handle screenshots
          // (`el.screenshot()`) interact with the viewport in ways
          // that triggered the same blank-output bug as a too-tight
          // clip; passing an explicit `{ x, y, width, height }` to
          // page.screenshot is the robust path.
          //
          // Coord-space gotcha (root-caused 2026-05-21 after every
          // saved deck rendered "slide 1 × N"): scrollIntoView keeps
          // Chrome painting one slide at a time inside the single-
          // slide viewport, BUT `getBoundingClientRect()` returns
          // VIEWPORT-relative coords (so slide N at viewport top is
          // (0, 0)). Puppeteer's `page.screenshot({ clip })` reads
          // clip in DOCUMENT coords (captureBeyondViewport defaults
          // to true with a clip, so the doc-coord interpretation
          // wins). Passing the raw viewport rect therefore always
          // captured document (0, 0) — slide 1 — regardless of which
          // slide we scrolled to. Add scrollX/Y back so the clip is
          // in document space.
          const bbox = await page.evaluate((escaped) => {
            const el = document.querySelector(`[data-slide-id="${escaped}"]`);
            if (!el) return null;
            // Scroll the target slide into view before measuring —
            // ensures Chrome has painted the slide before the
            // capture extends beyond the original viewport.
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
          // PNG → resize → WebP. Puppeteer's WebP encoder lacks the
          // quality knob sharp exposes, so we pay one extra encode
          // round trip for ~30 % smaller files.
          const png = await page.screenshot({ type: "png", clip: bbox });
          const webp = await sharp(Buffer.from(png))
            .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
            .webp({ quality: THUMBNAIL_QUALITY })
            .toBuffer();

          const path = `${ctx.supabaseUserId}/${projectId}/${savedVersionId}/${slide.slideId}.webp`;
          const { error: uploadError } = await admin.storage
            .from(BUCKET)
            .upload(path, webp, {
              contentType: "image/webp",
              // upsert so a retry overwrites the previous attempt
              // instead of 409-ing on the second run.
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
        await closeGuardedBrowser(browser);
      }
    });

    // ─── Step 3: write the URL array back ───────────────────────────
    await step.run("write-thumbnail-urls", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.project.update({
        where: { id: projectId },
        data: { thumbnailUrls },
      });
    });

    return { thumbnailCount: thumbnailUrls.length, savedVersionId };
  },
);

// Defensive escape for CSS attribute selectors. slideId is the
// stable per-slide key (e.g. "slide-01-cover") — alphanumeric +
// hyphen in practice — but escaping any non-word characters keeps
// the selector parser safe if Claude ever emits an oddly-shaped id.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
