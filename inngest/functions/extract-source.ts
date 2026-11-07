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

import { withUsageContext } from "@/lib/anthropic/usage-log";
import type { ReworkDecision } from "@/lib/extract/rework-score";
import type { EnhanceQuestions } from "@/lib/enhance/answers";
import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";
import { MissingToolError } from "@/lib/extract/missing-tool";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { extract } from "@/lib/extract";
import { pptToPptx } from "@/lib/extract/pptx-to-pdf";
import { uploadFileToAnthropic } from "@/lib/anthropic/files";

// Source files are staged in this bucket by POST /api/extract before
// the event fires. Path shape: `${supabaseUserId}/extract/${jobId}/${fileName}`.
const SOURCE_FILES_BUCKET = "source-files";
const PPT_MIME = "application/vnd.ms-powerpoint";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Payload the route emits. Keep in sync with POST /api/extract.
type ExtractRequestedEvent = {
  jobId: string;
  supabaseUserId: string;
  fileBucketPath: string; // path inside source-files bucket
  fileName: string;
  mime: string;
  // Which upload flow triggered this ("enhance" | "mimic" | undefined
  // for /create). Enhance no longer needs the extract-time PDF upload
  // to Anthropic — it rasterizes per-slide PNGs at GENERATION time —
  // so the upload is skipped for enhance to avoid orphaning a PDF on
  // every run. Optional for backward-compat with in-flight events.
  flowKind?: string;
  // The page's language, for /enhance's start-question labels ("ar" | "en").
  locale?: string;
  // /mimic file role ("content" | "design"). Lets the pipeline skip the
  // Anthropic upload for a content file consumed as text. Optional.
  mimicRole?: string;
};

// What we persist to Job.outputJson on completion. Mirrors the
// SourceMeta blob shape so /api/extract/[jobId] can return it
// directly to the client without reshaping.
type ExtractCompletedOutput = {
  // Anthropic Files API id for the source PDF (document-block flows:
  // /create file-upload + /mimic). UNDEFINED for enhance — that flow
  // rasterizes per-slide PNGs at generation time and never uses a PDF
  // document block, so the extract-time upload is skipped.
  anthropicFileId?: string;
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
  /** ISO 639-1 code of the source text (French, Turkish ...), null when unknown. */
  contentLang?: string | null;
  /**
   * Verbatim text per slide in presentation order (PPTX; empty for
   * PDF inputs). Index `i` ↔ rendered page `i + 1`. Handed to Claude
   * per slide so the redesign reproduces content word-for-word.
   */
  textPerSlide: string[];
  /**
   * The whole PDF's text layer (2026-07-11). Empty for PPTX + scanned
   * PDFs. /mimic forwards this as the content text so Claude reads the
   * FACTS, not a picture of the source document's layout. Absent field
   * (older in-flight jobs) → the client keeps the vision-block path.
   */
  fullText?: string;
  // Rework or Preserve, preselected on /enhance (lib/extract/rework-score.ts).
  rework?: ReworkDecision;
  // /enhance's start questions (lib/extract/enhance-questions.ts).
  questions?: EnhanceQuestions | null;
  /**
   * Supabase staging object key + MIME of the ORIGINAL upload.
   * deck-generate re-fetches it to rasterize the per-slide PNGs at
   * generation time (transient — flushed after the run).
   */
  sourcePath: string;
  sourceMime: string;
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
  // Pin the storage key to the event's OWN user namespace before any
  // service-role download below — the admin client bypasses RLS, so a
  // forged/malformed event must not be able to point it at another
  // user's object. The upload route always writes to
  // `${supabaseUserId}/extract/<jobId>/...`; reject anything that
  // escapes that prefix or carries path traversal.
  // Traversal means a path SEGMENT that is "." or "..": a ".." inside a file
  // name ("Marie-..pptx") is harmless (slashes never survive the name sanitizer)
  // and used to fail every such upload.
  if (
    ev.fileBucketPath.split("/").some((seg) => seg === ".." || seg === ".") ||
    !ev.fileBucketPath.startsWith(`${ev.supabaseUserId}/`)
  ) {
    throw new NonRetriableError(
      "extract-source: fileBucketPath escapes the event's user namespace",
    );
  }
  return ev as ExtractRequestedEvent;
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
// Best-effort progress write the /enhance upload UI polls for. Stored
// on Job.outputJson under `_progress` during processing; the final
// result overwrites it on completion. `percent` is the EXTRACTION-phase
// progress (0–100) which the client maps onto the tail of its bar. The
// LibreOffice convert has no sub-progress, so the bar honestly holds at
// the "converting" checkpoint (with a label) until it finishes —
// real milestones, never a faked smooth creep.
async function writeExtractProgress(
  jobId: string,
  percent: number,
  stage: "converting" | "analyzing" | "finishing",
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        outputJson: { _progress: { percent, stage } } as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
}

async function runExtractionPipeline(args: {
  jobId: string;
  fileBucketPath: string;
  fileName: string;
  mime: string;
  flowKind?: string;
  mimicRole?: string;
  locale?: "ar" | "en";
}): Promise<ExtractCompletedOutput> {
  const { jobId, fileBucketPath, fileName, mime, flowKind, mimicRole, locale } = args;
  const admin = getSupabaseAdmin();
  const { data: download, error: dlError } = await admin.storage
    .from(SOURCE_FILES_BUCKET)
    .download(fileBucketPath);
  if (dlError || !download) {
    throw new NonRetriableError(
      `Source file not found at ${fileBucketPath}: ${dlError?.message ?? "no data"}`,
    );
  }
  let sourceBuffer: Buffer = Buffer.from(await download.arrayBuffer());
  await writeExtractProgress(jobId, 20, "converting");

  // Legacy .ppt (owner, 2026-10-27): converted to .pptx once, here, and the
  // .pptx becomes the deck's source (stored beside the upload, same user /
  // job folder). Every later reader (exact text, colours, fonts, carried
  // pictures, tables, the pictures question) walks the OOXML zip; on a .ppt
  // they all came back empty.
  let sourcePath = fileBucketPath;
  let sourceMime = mime;
  if (mime === PPT_MIME) {
    sourceBuffer = await pptToPptx(sourceBuffer);
    sourcePath = fileBucketPath.replace(/\.ppt$/i, "") + ".pptx";
    const { error: upError } = await admin.storage
      .from(SOURCE_FILES_BUCKET)
      .upload(sourcePath, sourceBuffer, { contentType: PPTX_MIME, upsert: true });
    if (upError) throw new Error(`Converted .pptx upload failed: ${upError.message}`);
    sourceMime = PPTX_MIME;
  }

  // Run the extraction pipeline. Returns:
  //   • pdfBytes  — PDF the user uploaded OR LibreOffice-converted
  //                 from the PPTX
  //   • fonts     — PPTX theme XML typefaces
  //   • colors    — PPTX theme accents (Tier-1 only)
  //   • pageCount — from the PDF
  //   • format    — from the PDF's first-page aspect ratio
  // Embedded image extraction was removed (2026-05-25); Claude
  // reads visuals from the PDF document block directly.
  const ext = await extract({
    buffer: sourceBuffer,
    mime: sourceMime,
    ...(mime === PPT_MIME ? { convertedFromPpt: true } : {}),
    ...(flowKind === "enhance" ? { enhanceLocale: locale ?? "ar" } : {}),
  });
  await writeExtractProgress(jobId, 80, "analyzing");

  await writeExtractProgress(jobId, 92, "finishing");
  // Upload the PDF to Anthropic Files (referenced via a `document`
  // block in deck-generate) for /create + /mimic. SKIPPED for enhance:
  // that flow rasterizes per-slide PNGs at GENERATION time and never
  // uses a PDF document block, so an extract-time upload would orphan a
  // PDF on Anthropic every run. ALSO skipped for a /mimic CONTENT file
  // whose text layer was extracted (2026-07-11): MimicFlow then inlines
  // that text as `userContent` and never references the fileId, so the
  // upload would orphan a PDF too. The DESIGN reference (mimicRole
  // "design") always uploads - it IS the vision block - and a scanned
  // content file (empty fullText) still uploads for its vision fallback.
  // Filename keeps the original (minus any .pptx → .pdf swap).
  const contentTextUsed =
    flowKind === "mimic" && mimicRole === "content" && ext.fullText.length > 0;
  const anthropicFileId =
    flowKind === "enhance" || contentTextUsed
      ? undefined
      : await uploadFileToAnthropic({
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
    contentLang: ext.contentLang,
    textPerSlide: ext.textPerSlide,
    fullText: ext.fullText,
    rework: ext.rework,
    ...(ext.questions !== undefined ? { questions: ext.questions } : {}),
    // Re-fetch keys for generation-time rasterization (transient).
    sourcePath,
    sourceMime,
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
  async ({ event, step, logger }) => withUsageContext({ sourceKey: typeof (event.data as { jobId?: unknown }).jobId === "string" ? (event.data as { jobId: string }).jobId : null }, async () => {
    const data = parseExtractRequestedEvent(event.data);
    const { jobId, fileBucketPath, fileName, mime, flowKind, mimicRole } = data;

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
      runExtractionPipeline({
        jobId,
        fileBucketPath,
        fileName,
        mime,
        flowKind,
        mimicRole,
        locale: data.locale === "en" ? "en" : "ar",
      }).catch((err: unknown) => {
        // A missing host program (LibreOffice / pdftoppm) can't be fixed
        // by a retry: fail now instead of after every backoff.
        if (err instanceof MissingToolError) throw new NonRetriableError(err.message);
        throw err;
      }),
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
  }),
);
