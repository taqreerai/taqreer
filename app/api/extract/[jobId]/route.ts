// Phase 17.A — GET /api/extract/[jobId]
//
// Polling endpoint the upload-driven create flows hit every ~2-3 s
// while extract-source is processing. Returns the current Job state
// + the structured result once status="completed".
//
// Response shape:
//   { status: "queued" | "processing", progress?: number }
//   { status: "failed", error: string }
//   { status: "completed", result: ExtractCompletedOutput }
//
// ─── Auth model ───────────────────────────────────────────────────
// The Job table doesn't have a foreign key to User (it's generic).
// Auth is enforced by reading the supabaseUserId stash inside
// Job.inputJson and matching it against the caller. cuid-shaped Job
// IDs are unguessable, but cross-user access is the kind of bug
// that costs you when a session leaks; double-belt + suspenders.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

// Loose runtime shape of what we stashed in Job.inputJson at create
// time. Mirrors the POST /api/extract route's insert. Kept inline
// rather than imported so this route doesn't pull the route module.
type ExtractJobInput = {
  supabaseUserId?: string;
  fileName?: string;
  flowKind?: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  // ─── Auth ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Lookup ────────────────────────────────────────────────────
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      type: true,
      status: true,
      inputJson: true,
      outputJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.type !== "source-extract") {
    // Caller is polling the wrong job class — treat as not-found
    // rather than disclosing that some other-typed job exists with
    // this id.
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const input = (job.inputJson ?? {}) as ExtractJobInput;
  if (input.supabaseUserId !== user.id) {
    // Don't leak "exists but not yours" — same 404 as missing.
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // ─── Shape the response ────────────────────────────────────────
  if (job.status === "completed") {
    return NextResponse.json({
      status: "completed",
      result: job.outputJson,
      fileName: input.fileName,
      flowKind: input.flowKind,
    });
  }

  if (job.status === "failed") {
    const output = (job.outputJson ?? {}) as { error?: string };
    return NextResponse.json({
      status: "failed",
      error: output.error ?? "Extraction failed",
      fileName: input.fileName,
    });
  }

  // "queued" | "processing" — no progress signal yet (extract-source
  // doesn't tick partial updates; could add slides-rendered count
  // later if the UX needs it).
  return NextResponse.json({
    status: job.status,
    fileName: input.fileName,
    flowKind: input.flowKind,
  });
}
