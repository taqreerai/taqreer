// Phase 17.A — POST /api/extract
//
// File-upload entry point for the upload-driven create flows
// (Enhance + Mimic). Accepts a PDF or PPTX, stages it to Supabase,
// creates a Job row, and fires `source.extract.requested` so the
// extract-source Inngest function picks it up. Returns `{ jobId }`
// to the client, which then polls GET /api/extract/[jobId] for
// completion.
//
// ─── Why POST + polling, not server-side streaming ────────────────
// Extraction takes 15-30 s for a typical 12-slide deck (pdfjs is the
// bottleneck, ~1-3 s per page rasterized at 1920×1080). Doing the
// work inline in the request handler would hit Vercel's 60 s edge-
// function ceiling on larger decks AND tie up a request connection
// for the whole duration. Inngest gives us:
//   • Durable retries on transient storage errors
//   • Concurrency control via the function's concurrency.limit
//   • Status visibility through the Inngest dashboard
// Polling at 2-3 s intervals from the client is fine — extraction is
// always slow enough that the user expects a progress UI anyway.
//
// ─── Why source-files staging, not direct upload to extract-temp ──
// The existing `source-files` bucket is the canonical "user uploads
// raw input" bucket (same one /api/storage/upload writes to). Keeping
// extraction inputs there matches user-quota semantics. extract-temp
// is for the DERIVED slide PNGs the extraction produces.

import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { inngest } from "@/inngest/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { type SlideFormat } from "@/lib/schema/slide";

const SOURCE_FILES_BUCKET = "source-files";
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

function safeFileName(name: string) {
  // Same sanitizer the existing /api/storage/upload route uses.
  return name.replace(/[^\w.\-]+/g, "-");
}

export async function POST(request: Request) {
  try {
    // ─── Auth ──────────────────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── Env check ─────────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Storage service is not configured" },
        { status: 500 },
      );
    }

    // ─── Parse + validate ──────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");
    const rawFormat = String(formData.get("format") ?? "16:9");
    const rawKind = String(formData.get("kind") ?? "enhance");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "File is required" },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds 100 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 400 },
      );
    }
    // Resolve the canonical MIME. We trust `file.type` only when it's
    // in our allowlist; otherwise fall back to the filename extension
    // and OVERWRITE the working `mime` value with the canonical type.
    // Without this, browsers that report empty / "application/octet-
    // stream" for .pptx (Mac Safari, some drag-drop paths) would
    // sneak that wrong type into the Job row, the upload's
    // contentType, AND the Inngest event payload — which would then
    // fail dispatcher MIME branching downstream.
    let resolvedMime = file.type;
    if (!ALLOWED_MIME.has(file.type)) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".pdf")) {
        resolvedMime = "application/pdf";
      } else if (lower.endsWith(".pptx")) {
        resolvedMime =
          "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else if (lower.endsWith(".ppt")) {
        resolvedMime = "application/vnd.ms-powerpoint";
      } else {
        return NextResponse.json(
          {
            error:
              "Unsupported file type. Upload a PDF or PowerPoint (.pptx, .ppt).",
          },
          { status: 400 },
        );
      }
    }

    // Validate the requested slide format. Stored on the Job row
    // so /enhance/brand can hydrate the slideSize picker, but no
    // longer used for local rasterization (Phase 17.B-7 pivot —
    // Claude renders the PDF natively at its own resolution).
    const format: SlideFormat =
      rawFormat === "9:16" ? "9:16" : "16:9";

    // ─── Resolve the app User → supabaseUserId ─────────────────────
    // Supabase's user.id is the canonical id we store on every file
    // upload, so the Job row's audit trail keys off the same value
    // for cross-flow consistency.
    const supabaseUserId = user.id;

    // ─── Create Job row first (auth-gated, returns jobId) ──────────
    // Doing the insert before the upload guarantees we own the jobId
    // namespace for the storage path. Storage uploads are
    // best-effort idempotent; orphaning a Job row with no file is the
    // safer failure mode than orphaning a file with no Job row
    // (Inngest function NonRetriableErrors out on missing file).
    const job = await prisma.job.create({
      data: {
        type: "source-extract",
        status: "queued",
        inputJson: {
          supabaseUserId,
          fileName: file.name,
          mime: resolvedMime,
          flowKind: rawKind, // "enhance" | "mimic" — for downstream consumer
          format,
        },
      },
    });

    // ─── Upload source bytes to staging bucket ─────────────────────
    // Path: source-files/{supabaseUserId}/extract/{jobId}/{safeName}.
    // The user-id prefix matches the bucket's existing per-user
    // namespace convention; the {jobId} segment lets cascade-delete
    // target the exact upload when the Job row is later cleaned up.
    const bucketPath = `${supabaseUserId}/extract/${job.id}/${safeFileName(file.name)}`;
    const admin = createSupabaseAdminClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: uploadError } = await admin.storage
      .from(SOURCE_FILES_BUCKET)
      .upload(bucketPath, file, {
        contentType: resolvedMime || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      // Roll the Job row to "failed" so the client gets a clean error
      // instead of a perpetually-queued ghost row.
      await prisma.job
        .update({
          where: { id: job.id },
          data: {
            status: "failed",
            outputJson: { error: `Upload failed: ${uploadError.message}` },
          },
        })
        .catch(() => {
          /* best-effort */
        });
      return NextResponse.json(
        { error: `Failed to upload source: ${uploadError.message}` },
        { status: 500 },
      );
    }

    // ─── Fire the extraction event ─────────────────────────────────
    // step.run inside extract-source memoizes each phase, so retry
    // semantics are safe even though we hand off raw paths here.
    try {
      await inngest.send({
        name: "source.extract.requested",
        // Event-level id makes the trigger idempotent — re-firing
        // with the same id is a no-op on Inngest's side. Same jobId
        // can't accidentally double-process.
        id: `extract:${job.id}`,
        data: {
          jobId: job.id,
          supabaseUserId,
          fileBucketPath: bucketPath,
          fileName: file.name,
          mime: resolvedMime,
        },
      });
    } catch (err) {
      // Event-send failure is recoverable — the file is uploaded,
      // the Job row exists. A retry of POST /api/extract would
      // create a new Job + duplicate the file. Cleaner: surface the
      // failure and let the client retry. Mark this Job failed too.
      console.error("[extract] inngest.send failed:", err);
      await prisma.job
        .update({
          where: { id: job.id },
          data: {
            status: "failed",
            outputJson: { error: "Failed to enqueue extraction job" },
          },
        })
        .catch(() => {
          /* best-effort */
        });
      return NextResponse.json(
        { error: "Failed to start extraction. Try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error("[extract] route error:", err);
    return NextResponse.json(
      { error: "Failed to start extraction" },
      { status: 500 },
    );
  }
}
