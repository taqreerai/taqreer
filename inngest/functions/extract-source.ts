// Phase 17.A/B — Extract uploaded source files (PDF/PPTX) into the
// structured payload the upload-driven create flows consume.
//
// Triggered by `inngest.send({ name: "source.extract.requested", … })`
// from POST /api/extract once the file is uploaded to the staging
// bucket. The function:
//   1. Downloads the source file from `source-files/`
//   2. Normalizes to PDF (PPTX → LibreOffice; PDF passes through)
//   3. Uploads the PDF to Anthropic Files API → file_id
//   4. For PPTX only: pulls font names + theme colors from the zip
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
// ─── Asset extraction removed (2026-05-25) ────────────────────────
// We also used to extract embedded images from the PPTX zip and
// upload them to `project-assets/{jobId}/` so the generated HTML
// could reference them by URL. Removed entirely — extracted assets
// clashed visually with Claude's clean inline-SVG output and made
// redesigned decks look uneven. Claude reads visuals directly from
// the PDF document block and recreates them in his own style.
//
// ─── Why a Job row, not a dedicated ExtractJob model ───────────────
// The existing `Job` Prisma model is already a generic queue-state
// tracker (status / inputJson / outputJson) used by deck-generate and
// brand-analyze. type="source-extract" reuses the same plumbing
// (status polling, error storage, telemetry) without a migration.
// projectId is nullable, which fits: extraction runs BEFORE the
// project exists.

import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { extract } from "@/lib/extract";
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
  fonts: string[];
  colors: string[];
  /** PDF page count → drives slide count in the generated deck. */
  pageCount: number;
  /** Slide format from the PDF's first-page aspect ratio. */
  format: "16:9" | "9:16";
  /**
   * Detected source language ("ar" | "en" | null). PPTX inputs run
   * a quick text-sample detection; PDF inputs return null and the
   * /enhance client falls through to a default. Used to seed the
   * brief's `language` so the preview SlideNavSidebar renders the
   * right direction from the first paint.
   */
  language: "ar" | "en" | null;
};

// Narrow `event.data` to `ExtractRequestedEvent`. Throws
// `NonRetriableError` on malformed input so Inngest stops retrying.
function parseExtractRequestedEvent(data: unknown): ExtractRequestedEvent {
  const ev = data as Partial<ExtractRequestedEvent> | null;
  if (
    !ev ||
    !ev.jobId ||
    !ev.supabaseUserId ||
    !ev.fileBucketPath ||
    !ev.fileName ||
    !ev.mime
  ) {
    // Without `fileName` the function would later throw a TypeError
    // inside `toPdfFileName(fileName)` — fail fast with a clear
    // message + NonRetriableError so Inngest doesn't burn retries on
    // a deterministically-broken payload. CR #1 (PR #40).
    throw new NonRetriableError(
      "extract-source: malformed event payload (missing jobId / userId / path / fileName / mime)",
    );
  }
  return ev as ExtractRequestedEvent;
}

// Build a Supabase admin client with the service-role key — used
// because Inngest doesn't carry the original uploader's auth
// context. Reused across functions; hoisting it here gives one call
// site that's grep-able when env names change.
function getSupabaseAdmin() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Rename a non-PDF source file to its `.pdf` form for the upload to
// Anthropic Files (Files API enforces content-type ↔ extension
// agreement). Passes `.pdf` through unchanged; otherwise swaps the
// final extension.
function toPdfFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith(".pdf")
    ? fileName
    : fileName.replace(/\.[^.]+$/, ".pdf");
}

// Tiny wrapper around `prisma.job.update` for the three call sites
// (mark-processing, mark-failed via onFailure, mark-completed). The
// dynamic `import("@/lib/prisma")` is kept here to preserve the
// Inngest cold-start optimisation — pulling Prisma in only when a
// step actually runs.
async function updateJobStatus(
  jobId: string,
  data: Prisma.JobUpdateInput,
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  await prisma.job.update({ where: { id: jobId }, data });
}

// Download the source bytes, run the PPTX/PDF extraction pipeline,
// upload the PDF to Anthropic Files. Returns the `ExtractCompletedOutput`
// blob persisted to `Job.outputJson`. Lifted out of the `step.run`
// closure so the orchestration body stays scannable.
async function runExtractionPipeline(args: {
  fileBucketPath: string;
  fileName: string;
  mime: string;
}): Promise<ExtractCompletedOutput> {
  const { fileBucketPath, fileName, mime } = args;
  const admin = getSupabaseAdmin();
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
  //   • pdfBytes  — PDF the user uploaded OR LibreOffice-converted
  //                 from the PPTX
  //   • fonts     — PPTX theme XML typefaces
  //   • colors    — PPTX theme accents (Tier-1 only)
  //   • pageCount — from the PDF
  //   • format    — from the PDF's first-page aspect ratio
  // Embedded image extraction was removed (2026-05-25); Claude
  // reads visuals from the PDF document block directly.
  const ext = await extract({ buffer: sourceBuffer, mime });

  // Upload the PDF to Anthropic Files. Returns a file_id we
  // reference in deck-generate's message via a `document` block.
  // Filename keeps the original (minus any .pptx → .pdf swap so the
  // dashboard label matches).
  const anthropicFileId = await uploadFileToAnthropic({
    bytes: ext.pdfBytes,
    fileName: toPdfFileName(fileName),
    contentType: "application/pdf",
  });

  return {
    anthropicFileId,
    fonts: ext.fonts,
    colors: ext.colors,
    pageCount: ext.pageCount,
    format: ext.format,
    language: ext.language,
  };
}

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
    // Terminal-failure handler — fires once after every retry is
    // exhausted. Writes the error onto Job.outputJson so
    // /api/extract/[jobId] can surface a meaningful message.
    // Previously inline `try/catch` in the orchestration body did
    // this on every attempt; using onFailure means the bookkeeping
    // runs exactly once at the END (no race with Inngest's retry
    // semantics) and the happy path stops being indented inside a
    // try block.
    onFailure: async ({ event, error }) => {
      const original = (event.data.event?.data ?? {}) as Partial<
        ExtractRequestedEvent
      >;
      if (!original.jobId) return;
      const message =
        error instanceof Error ? error.message : "Unknown extraction error";
      await updateJobStatus(original.jobId, {
        status: "failed",
        outputJson: { error: message, fileName: original.fileName ?? null },
      }).catch((e) => {
        console.error("extract-source onFailure: status write failed", e, error);
      });
    },
  },
  async ({ event, step, logger }) => {
    const data = parseExtractRequestedEvent(event.data);
    const { jobId, fileBucketPath, fileName, mime } = data;

    // ─── Step 1: mark job processing ─────────────────────────────────
    await step.run("mark-processing", () =>
      updateJobStatus(jobId, {
        status: "processing",
        attempts: { increment: 1 },
      }),
    );

    // ─── Step 2: download + normalize + upload (fat idempotent step) ─
    // We bundle download → extract → Anthropic-upload into a single
    // step.run. The Anthropic Files API doesn't dedupe on its end,
    // but a retry's new file_id just costs us a free file we don't
    // reuse — cheap insurance. Bundling means a retry replays the
    // whole pipeline cleanly without partial-state Job row updates.
    // Errors bubble up to the `onFailure` hook above for the
    // mark-failed bookkeeping.
    const result = await step.run("extract-and-upload", () =>
      runExtractionPipeline({ fileBucketPath, fileName, mime }),
    );
    logger.info("extract-source pipeline complete", {
      jobId,
      pageCount: result.pageCount,
      format: result.format,
    });

    // ─── Step 3: mark job completed + persist result ─────────────────
    await step.run("mark-completed", () =>
      updateJobStatus(jobId, {
        status: "completed",
        outputJson: result as Prisma.InputJsonValue,
      }),
    );

    return { jobId, status: "completed" };
  },
);
