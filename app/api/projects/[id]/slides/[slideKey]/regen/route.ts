// POST /api/projects/[id]/slides/[slideKey]/regen
//
// Per-slide regen used by the slide pill (the "Regen" + "Try again"
// buttons). Distinct from /api/projects/[id]/regenerate-partial
// which fires the comment-bar's "apply drafts" flow:
//   - This route NEVER touches the Comment table — comments here
//     come from SlideState.cachedComments (replay) or are empty
//     (clean regen). The user is acting on a SINGLE slide via the
//     pill, not promoting a deck-wide set of drafts.
//   - This route always targets one slideKey (URL path).
//
// Body: { replay?: boolean }   (default false)
//   replay=true  → use cachedComments from SlideState (Try again)
//   replay=false → use [] (clean regen, no user comments)
//
// On success, dispatches `deck.regenerate.partial.requested` with
// the same shape the existing route uses, so the Inngest worker
// path is identical. The worker writes the new SlideVersion +
// updates SlideState.cachedComments per the comments it received
// (see lib/db/slide-versioning.ts).

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isQuality, type Quality } from "@/lib/types/quality";

type RegenPayload = {
  replay?: boolean;
};

type CachedComment = {
  slideId: string;
  content: string;
  boundsJson: unknown;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, slideKey } = await params;
  const body = (await request.json().catch(() => ({}))) as RegenPayload;
  const replay = body.replay === true;

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    include: {
      presentation: {
        include: {
          versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        },
      },
    },
  });
  if (
    !project ||
    !project.presentation ||
    !project.presentation.currentVersionId
  ) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const presentation = project.presentation;
  const sourceVersionId = presentation.currentVersionId;

  // Replay needs cached comments. If the slide has no cache, the
  // pill should have disabled Try Again on the client — but defend
  // server-side too.
  let comments: CachedComment[] = [];
  if (replay) {
    const state = await prisma.slideState.findUnique({
      where: {
        presentationId_slideKey: {
          presentationId: presentation.id,
          slideKey,
        },
      },
      select: { cachedComments: true },
    });
    const cached = state?.cachedComments;
    if (!Array.isArray(cached) || cached.length === 0) {
      return NextResponse.json(
        { error: "No cached comments to replay for this slide" },
        { status: 400 },
      );
    }
    comments = cached as CachedComment[];
  }

  // Allocate a new PresentationVersion seeded from the current one
  // (same pattern as /regenerate-partial). Wrapped in $transaction
  // with retry on the unique-index race so concurrent regens don't
  // collide on versionNumber.
  let newVersion: { id: string; versionNumber: number } | null = null;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const allocated = await prisma.$transaction(async (tx) => {
        const latest = await tx.presentationVersion.findFirst({
          where: { presentationId: presentation.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true, slideJson: true },
        });
        const nextNumber = (latest?.versionNumber ?? 0) + 1;
        return tx.presentationVersion.create({
          data: {
            presentationId: presentation.id,
            versionNumber: nextNumber,
            status: "queued",
            slideJson: toJson(
              latest?.slideJson ?? { status: "queued", slides: [] },
            ),
          },
          select: { id: true, versionNumber: true },
        });
      });
      newVersion = allocated;
      break;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "P2002" || attempt === MAX_ATTEMPTS - 1) throw error;
    }
  }
  if (!newVersion) {
    return NextResponse.json(
      { error: "Failed to allocate a new presentation version" },
      { status: 500 },
    );
  }

  // Original quality preset — same logic as /regenerate-partial so
  // the per-slide regen reuses the user's model + thinking choice.
  const lastJob = await prisma.job.findFirst({
    where: {
      projectId: project.id,
      type: "deck.generate",
      status: "succeeded",
    },
    orderBy: { createdAt: "desc" },
    select: { inputJson: true },
  });
  const lastInput = (lastJob?.inputJson ?? null) as { quality?: unknown } | null;
  const originalQuality: Quality | null = isQuality(lastInput?.quality)
    ? lastInput.quality
    : null;

  // Job row + Inngest dispatch in a single try/catch so a failure
  // at either step rolls back the version + job (matching the
  // existing /regenerate-partial pattern for "no stranded state").
  let regenJobId: string | null = null;
  try {
    const regenJob = await prisma.job.create({
      data: {
        project: { connect: { id: project.id } },
        type: "deck.regenerate.partial",
        status: "queued",
        inputJson: toJson({
          sourceVersionId,
          versionId: newVersion.id,
          targetSlideIds: [slideKey],
          commentCount: comments.length,
          quality: originalQuality,
          source: replay ? "pill_replay" : "pill_clean",
        }),
        quality: originalQuality ?? "medium",
      },
    });
    regenJobId = regenJob.id;
    await sendInngestEventWithRetry({
      name: "deck.regenerate.partial.requested",
      data: {
        projectId: project.id,
        presentationId: presentation.id,
        versionId: newVersion.id,
        sourceVersionId,
        targetSlideIds: [slideKey],
        comments,
        quality: originalQuality,
        jobId: regenJob.id,
      },
    });
  } catch (error) {
    await prisma.presentationVersion
      .update({ where: { id: newVersion.id }, data: { status: "failed" } })
      .catch(() => undefined);
    if (regenJobId) {
      await prisma.job
        .update({ where: { id: regenJobId }, data: { status: "failed" } })
        .catch(() => undefined);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to dispatch regenerate",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    versionId: newVersion.id,
    versionNumber: newVersion.versionNumber,
    targetSlideIds: [slideKey],
  });
}
