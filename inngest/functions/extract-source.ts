// Phase 17.A/B — Extract uploaded source files (PDF/PPTX) into the
// structured payload the upload-driven create flows consume.
//
// Triggered by `inngest.send({ name: "source.extract.requested", … })`
// from POST /api/extract once the file is uploaded to the staging
// bucket. The function:
//   1. Downloads the source file from `source-files/`
//   2. Normalizes to PDF (PPTX → LibreOffice; PDF passes through)
//   3. Uploads the PDF to Anthropic Files API → file_id
//   4. For PPTX only: extracts embedded assets / fonts / theme
//      colors from the zip and uploads assets to project-assets/
//   5. Writes the result to Job.outputJson so /api/extract/[jobId]
//      can return it
//
// ─── Phase 17.B-7 architectural pivot ─────────────────────────────
// We used to rasterize each slide to PNG via pdfjs-dist + @napi-rs/
// canvas, upload PNGs to `extract-temp/`, and hand Claude N image
// blocks. Now: Claude renders the PDF natively via Anthropic Files
// API + a single `document` block. Reasons:
//   • Skip Turbopack's pdfjs bundling hell entirely
//   • Better visual fidelity (Claude's vision is purpose-built for
//     PDF rendering)
//   • ~500 lines of rasterize/canvas code deleted
//   • No `extract-temp` Supabase bucket
//
// ─── Why a Job row, not a dedicated ExtractJob model ───────────────
// The existing `Job` Prisma model is already a generic queue-state
// tracker (status / inputJson / outputJson) used by deck-generate and
// brand-analyze. type="source-extract" reuses the same plumbing
// (status polling, error storage, telemetry) without a migration.
// projectId is nullable, which fits: extraction runs BEFORE the
// project exists.

import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { extract } from "@/lib/extract";
import {
  uploadProjectAssets,
  type UploadedAsset,
} from "@/lib/storage/project-assets";
import { uploadFileToAnthropic } from "@/lib/anthropic/files";

// Source files are staged in this bucket by POST /api/extract before
// the event fires. Path shape: `${supabaseUserId}/extract/${jobId}/${fileName}`.
const SOURCE_FILES_BUCKET = "source-files";

// Payload the route emits. Keep in sync with POST /api/extract.
type ExtractRequestedEvent = {
  jobId: string;
  supabaseUserId: string;
  fileBucketPath: string; // path inside source-files bucket
  fileName: string;
  mime: string;
};

// What we persist to Job.outputJson on completion. Mirrors the
// SourceMeta blob shape so /api/extract/[jobId] can return it
// directly to the client without reshaping.
type ExtractCompletedOutput = {
  anthropicFileId: string;
  embeddedAssets: UploadedAsset[];
  fonts: string[];
  colors: string[];
};

export const extractSource = inngest.createFunction(
  {
    id: "extract-source",
    name: "Extract uploaded PDF/PPTX → Anthropic Files + brand metadata",
    // Two attempts max — extraction is deterministic. A retry
    // helps with transient storage / Anthropic upload hiccups.
    // Beyond that, NonRetriableError + caller re-trigger is the
    // escape valve.
    retries: 2,
    // Cap concurrency. LibreOffice + Supabase + Anthropic file
    // upload are all I/O-bound, but LibreOffice can be CPU-heavy
    // briefly during PPTX→PDF rendering.
    concurrency: { limit: 2 },
    triggers: [{ event: "source.extract.requested" }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as ExtractRequestedEvent;
    const { jobId, supabaseUserId, fileBucketPath, fileName, mime } = data;

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

    // ─── Step 2: download + normalize + upload (fat idempotent step) ─
    // We bundle download → extract → Anthropic-upload → Supabase-
    // asset-upload into a single step.run. The individual sub-
    // steps are individually idempotent (uploadProjectAssets uses
    // content-hash + upsert:true; Anthropic Files API doesn't
    // dedupe but a retry's new file_id just costs us a free file
    // we don't reuse). Bundling means a retry replays the whole
    // pipeline cleanly without partial-state Job row updates.
    let result: ExtractCompletedOutput;
    try {
      result = await step.run("extract-and-upload", async () => {
        // Download source bytes from the staging bucket. Service
        // role because Inngest doesn't carry the original
        // uploader's auth context.
        const admin = createSupabaseAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: download, error: dlError } = await admin.storage
          .from(SOURCE_FILES_BUCKET)
          .download(fileBucketPath);
        if (dlError || !download) {
          throw new NonRetriableError(
            `Source file not found at ${fileBucketPath}: ${dlError?.message ?? "no data"}`,
          );
        }
        const sourceBuffer = Buffer.from(await download.arrayBuffer());

        // Run the extraction pipeline. Returns:
        //   • pdfBytes      — PDF the user uploaded OR LibreOffice-
        //                     converted from the PPTX
        //   • embeddedAssets — PPTX only (PDF zip-walk path deferred)
        //   • fonts          — PPTX theme XML
        //   • colors         — PPTX theme accents (Tier-1 only;
        //                     Tier-2 histogram deleted with the
        //                     local rasterizer)
        const ext = await extract({ buffer: sourceBuffer, mime });

        // Upload the PDF to Anthropic Files API. Returns a
        // file_id we reference in deck-generate's message via a
        // `document` block. Filename keeps the original (minus
        // any .pptx → .pdf swap so the dashboard label matches).
        const pdfFileName = fileName.toLowerCase().endsWith(".pdf")
          ? fileName
          : fileName.replace(/\.[^.]+$/, ".pdf");
        const anthropicFileId = await uploadFileToAnthropic({
          bytes: ext.pdfBytes,
          fileName: pdfFileName,
          contentType: "application/pdf",
        });

        // Upload embedded assets to project-assets/ for the
        // generated HTML to reference by URL. Content-hash
        // deduped + upsert:true → retry-safe.
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
          anthropicFileId,
          embeddedAssets: uploadedAssets,
          fonts: ext.fonts,
          colors: ext.colors,
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
          outputJson: result as unknown as object,
        },
      });
    });

    return { jobId, status: "completed" };
  },
);
