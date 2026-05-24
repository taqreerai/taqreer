// Phase 17.A — Extract uploaded source files (PDF/PPTX) into the
// structured payload the upload-driven create flows consume.
//
// Triggered by `inngest.send({ name: "source.extract.requested", … })`
// from POST /api/extract once the file is uploaded to the staging
// bucket. The function downloads the source file, runs the full
// extraction pipeline (rasterize → embedded assets → fonts → colors),
// uploads the slide PNGs to `extract-temp/{jobId}/` and embedded
// assets to `project-assets/{jobId}/`, and writes the result onto
// the Job row so /api/extract/[jobId] can poll completion.
//
// ─── Why a Job row, not a dedicated ExtractJob model ───────────────
// The existing `Job` Prisma model is already a generic queue-state
// tracker (status / inputJson / outputJson) used by deck-generate and
// brand-analyze. type="source-extract" reuses the same plumbing
// (status polling, error storage, telemetry) without a migration.
// projectId is nullable, which fits: extraction runs BEFORE the
// project exists.
//
// ─── Step layout ──────────────────────────────────────────────────
//   1. mark-processing     → Job.status flips "queued" → "processing"
//   2. extract-and-upload  → fat step: download + extract + upload.
//      Idempotent on retry because uploadSlideRasters uses upsert:true
//      and uploadProjectAssets keys by content hash + upsert:true
//      (see lib/storage/project-assets.ts CR-#4 fix). Returns only
//      URLs + small metadata — never Buffers (Inngest step.run
//      results are JSON-serialized).
//   3. mark-completed      → Job.outputJson = result, status = "completed"
// On terminal failure we catch outside the steps and write
// status="failed" with the message in outputJson so the client can
// surface a meaningful error.

import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { extract } from "@/lib/extract";
import {
  uploadSlideRasters,
  uploadProjectAssets,
  type UploadedSlide,
  type UploadedAsset,
} from "@/lib/storage/project-assets";

// Source files are staged in this bucket by POST /api/extract before
// the event fires. Path shape: `${supabaseUserId}/extract/${jobId}/${fileName}`.
const SOURCE_FILES_BUCKET = "source-files";

// Payload the route emits. Keep in sync with the matching shape in
// POST /api/extract.
type ExtractRequestedEvent = {
  jobId: string;
  supabaseUserId: string;
  fileBucketPath: string; // path inside source-files bucket
  fileName: string;
  mime: string;
  // Caller passes the desired raster output dimensions; we don't
  // infer from the source because PDFs can be any size.
  targetWidth: number;
  targetHeight: number;
};

// What we persist to Job.outputJson on completion. Mirrors the
// SourceMeta blob shape so /api/extract/[jobId] can return it
// directly to the client without reshaping.
type ExtractCompletedOutput = {
  slideImageUrls: UploadedSlide[];
  embeddedAssets: UploadedAsset[];
  fonts: string[];
  colors: string[];
  colorTier: "theme" | "histogram" | "none";
};

export const extractSource = inngest.createFunction(
  {
    id: "extract-source",
    name: "Extract uploaded PDF/PPTX into slide PNGs + assets",
    // Two attempts max — extraction is deterministic (no API calls
    // to flaky providers), so a retry only helps with transient
    // storage hiccups. Beyond that, NonRetriableError + caller
    // re-trigger is the right escape valve.
    retries: 2,
    // Cap concurrency: each job spawns pdfjs + sharp + Supabase
    // I/O and can briefly use 200-400 MB resident. Two parallel
    // jobs is a safe ceiling for the current Inngest worker.
    concurrency: { limit: 2 },
    triggers: [{ event: "source.extract.requested" }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as ExtractRequestedEvent;
    const { jobId, supabaseUserId, fileBucketPath, fileName, mime } = data;
    const { targetWidth, targetHeight } = data;

    if (!jobId || !supabaseUserId || !fileBucketPath || !mime) {
      throw new NonRetriableError(
        `extract-source: malformed event payload (missing jobId / userId / path / mime)`,
      );
    }

    // ─── Step 1: mark job processing ─────────────────────────────────
    await step.run("mark-processing", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "processing", attempts: { increment: 1 } },
      });
    });

    // ─── Step 2: download + extract + upload (fat idempotent step) ───
    let result: ExtractCompletedOutput;
    try {
      result = await step.run("extract-and-upload", async () => {
        // Download source bytes from the staging bucket. Service role
        // because the event handler runs server-side without an
        // authenticated user context (the original uploader's auth
        // doesn't propagate through Inngest).
        const admin = createSupabaseAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: download, error: dlError } = await admin.storage
          .from(SOURCE_FILES_BUCKET)
          .download(fileBucketPath);
        if (dlError || !download) {
          // Missing source file is non-retriable — either the route
          // failed to upload, the user deleted it manually, or the
          // path is wrong. None of these resolve on retry.
          throw new NonRetriableError(
            `Source file not found at ${fileBucketPath}: ${dlError?.message ?? "no data"}`,
          );
        }
        const sourceBuffer = Buffer.from(await download.arrayBuffer());

        // Run the extraction pipeline. Throws if the file isn't
        // a valid PDF/PPTX — let it propagate so Inngest marks the
        // attempt failed and either retries (transient) or surfaces
        // via the catch below (terminal).
        const ext = await extract({
          buffer: sourceBuffer,
          mime,
          width: targetWidth,
          height: targetHeight,
        });

        // Upload slides + assets in series (small, low-concurrency).
        // Both helpers are idempotent (upsert:true), so an Inngest
        // retry of this same step replays the uploads against the
        // same storage paths without creating duplicates.
        const uploadedSlides = await uploadSlideRasters(
          jobId,
          ext.slides.map((s) => ({ index: s.index, png: s.png })),
        );
        const uploadedAssets = await uploadProjectAssets(
          jobId,
          ext.embeddedAssets.map((a) => ({
            fileName: a.fileName,
            contentType: a.contentType,
            bytes: a.bytes,
            slideIndices: a.slideIndices,
          })),
        );

        return {
          slideImageUrls: uploadedSlides,
          embeddedAssets: uploadedAssets,
          fonts: ext.fonts,
          colors: ext.colors,
          colorTier: ext.colorTier,
        } satisfies ExtractCompletedOutput;
      });
    } catch (err) {
      // Terminal failure path. Write the error onto the Job row so
      // /api/extract/[jobId] can surface a meaningful message and
      // re-throw so Inngest registers the function as failed.
      const message =
        err instanceof Error ? err.message : "Unknown extraction error";
      logger.error("extract-source failed", {
        jobId,
        fileName,
        error: message,
      });
      await step.run("mark-failed", async () => {
        const { prisma } = await import("@/lib/prisma");
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            outputJson: { error: message, fileName },
          },
        });
      });
      throw err;
    }

    // ─── Step 3: mark job completed + persist result ─────────────────
    await step.run("mark-completed", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "completed",
          // Cast through `unknown` — JSON columns accept any JSON-
          // serializable structure but Prisma's input type doesn't
          // express our nested record type narrowly.
          outputJson: result as unknown as object,
        },
      });
    });

    return { jobId, status: "completed" };
  },
);
