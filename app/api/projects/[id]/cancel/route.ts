// POST /api/projects/[id]/cancel
//
// Mid-generation cancel. Stops Claude streaming + the surrounding
// Inngest run, discards all partial slides, marks Project / Version /
// Job as "cancelled". Belt + suspenders:
//
//   1. Inngest `cancelOn` (declarative) — fires
//      `deck.generate.cancel.requested` with `data.jobId`. Inngest
//      tears the function envelope down at the next step boundary
//      and skips retries.
//   2. DB cancel flag (imperative, mid-stream) — sets
//      `Job.cancelRequestedAt = NOW()`. The deck-generate worker
//      polls this column on every closed slide in the streaming
//      parser and calls `stream.controller.abort()` when it flips.
//      This is what actually stops the Anthropic stream mid-flight
//      so the user stops paying output tokens.
//
// Both run from this single endpoint — the DB flip happens in the
// transaction below, the Inngest event fires immediately after.
//
// ─── Access ────────────────────────────────────────────────────────
// Edit access required. Owner + accepted edit-share collaborators
// can cancel; comment / view / public-view roles get 403. Matches
// the regenerate route's gate — anyone who can re-trigger a run
// can also kill one in flight.
//
// ─── State transitions on success ──────────────────────────────────
//   • Job.cancelRequestedAt   = NOW()
//   • Job.status              = "cancelled"
//   • Project.status          = "cancelled"
//   • Version.status          = "cancelled"
//   • Version.slideJson       = { status: "cancelled", slides: [] }
//     (discard all partial slides per the product call 2026-05-27;
//      the user can re-create with adjusted settings if they want
//      a different deck)
//   • Broadcast `deck.regen.finished` so the DeckView listener
//     re-fetches status and surfaces the "cancelled" recovery card.

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

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

  const currentVersionId = project.presentation.currentVersionId;

  // Atomic state flip — job + project + version all move to cancelled
  // in one tx so a partial failure can't leave the UI in a half-state
  // ("project cancelled but version still generating").
  try {
    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: latestJob.id },
        data: {
          cancelRequestedAt: new Date(),
          status: "cancelled",
        },
      });
      await tx.project.update({
        where: { id: project.id },
        data: { status: "cancelled" },
      });
      if (currentVersionId) {
        await tx.presentationVersion.update({
          where: { id: currentVersionId },
          data: {
            status: "cancelled",
            // Discard all partial slides — the product policy is "cancel
            // means start over", not "save what's done". See route header
            // comment for the rationale.
            slideJson: toJson({ status: "cancelled", slides: [] }),
          },
        });
      }
    });
  } catch (err) {
    console.error("[cancel] transaction failed", err);
    return NextResponse.json(
      { error: "Failed to update cancellation state" },
      { status: 500 },
    );
  }

  // Fire the Inngest cancellation event. The deck-generate function
  // declares `cancelOn: [{ event: "deck.generate.cancel.requested",
  // match: "data.jobId" }]` so this stops the run at the next step
  // boundary (and skips remaining retries). Belt + suspenders with
  // the DB flag above: the worker's in-stream poll aborts the
  // Anthropic stream mid-flight so output-token billing stops
  // immediately; Inngest tears down the function envelope after.
  try {
    await sendInngestEventWithRetry({
      name: "deck.generate.cancel.requested",
      id: `cancel:${latestJob.id}`,
      data: { jobId: latestJob.id, projectId: project.id },
    });
  } catch (err) {
    // Best-effort: if Inngest is unreachable, the DB poll still
    // catches the cancel on the next stream tick. Don't fail the
    // request — the user's intent (mark cancelled) is honored
    // by the DB transaction above.
    console.error("[cancel] inngest.send failed", err);
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
