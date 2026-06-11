// POST /api/projects/[id]/cancel
//
// Mid-generation cancel - KEEPS-PARTIAL policy (billing plan §7,
// 2026-06-11, supersedes the 2026-05-27 discard policy): the user
// keeps every slide that finished streaming and pays for exactly
// those; a cancel before the first slide is a full refund.
//
// This route is now a pure SIGNAL: it sets `Job.cancelRequestedAt`
// (+ flips Job.status for idempotency). The deck-generate worker
// polls that column on every closed slide, aborts the Anthropic
// stream (which is what stops output-token billing mid-flight), and
// then OWNS the terminal state: with kept slides it saves the partial
// deck as a normal completed (short) deck and settles the credit hold
// for the produced count; with zero slides it marks everything
// cancelled and releases the hold in full. The old `cancelOn` Inngest
// event was removed with this policy - it killed the function before
// its save/settle steps could run.
//
// ─── Access ────────────────────────────────────────────────────────
// Edit access required. Owner + accepted edit-share collaborators
// can cancel; comment / view / public-view roles get 403. Matches
// the regenerate route's gate — anyone who can re-trigger a run
// can also kill one in flight.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Phase 15.A: edit access required — same gate as regenerate.
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Find the in-flight job + version. We grab the LATEST deck-generate
  // job because cancellation only makes sense for the most recent run
  // (older jobs are either completed or already failed/cancelled).
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      presentation: {
        select: {
          id: true,
          currentVersionId: true,
        },
      },
      jobs: {
        where: { type: "deck.generate" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const latestJob = project.jobs[0];
  if (!latestJob) {
    return NextResponse.json(
      { error: "No generation job to cancel" },
      { status: 400 },
    );
  }

  // Idempotency: if the job already finished (success or terminal
  // failure) OR is already marked cancelled, return 200 with the
  // current state instead of erroring. Lets the UI fire-and-forget
  // without worrying about race-with-completion timing.
  //
  // Status vocabulary (Inngest-aligned, see DISTINCT Job.status query
  // — values in use: `queued`, `succeeded`, `failed`, `cancelled`).
  // Mid-run rows are `queued` (before the function picks them up)
  // or absent of a terminal flip (Inngest manages the lifecycle).
  // Anything NOT in the active set is treated as terminal so a stale
  // browser tab can't destroy a completed deck by re-firing cancel.
  const ACTIVE_JOB_STATUSES = new Set(["queued", "processing", "running"]);
  if (!ACTIVE_JOB_STATUSES.has(latestJob.status)) {
    return NextResponse.json({
      ok: true,
      alreadyTerminal: true,
      status: latestJob.status,
    });
  }

  // Signal the worker. Keeps-partial: the worker owns every terminal
  // write from here (save partial deck + settle, or mark cancelled +
  // release). Job.status flips to "cancelled" for the idempotency
  // check above; the worker overwrites it with the real terminal
  // state ("succeeded" when slides were kept).
  try {
    await prisma.job.update({
      where: { id: latestJob.id },
      data: {
        cancelRequestedAt: new Date(),
        status: "cancelled",
      },
    });
  } catch (err) {
    console.error("[cancel] job update failed", err);
    return NextResponse.json(
      { error: "Failed to update cancellation state" },
      { status: 500 },
    );
  }

  // Broadcast so other viewers (and the local DeckView poller) see
  // the state change without waiting for the next status-poll cycle.
  try {
    await broadcastToProject(project.id, "deck.regen.finished", {
      actorPrismaUserId: access.user.prismaId ?? null,
    });
  } catch (err) {
    console.error("[cancel] broadcast failed", err);
  }

  return NextResponse.json({ ok: true, alreadyTerminal: false });
}
