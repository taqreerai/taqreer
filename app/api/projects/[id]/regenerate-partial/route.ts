import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Apply the user's draft comments by:
//   1. promoting them to status="applied" (so they can't be edited / re-fired)
//   2. allocating a new PresentationVersion (v_n+1) as a copy of the current
//   3. dispatching `deck.regenerate.partial.requested` to Inngest, which calls
//      Claude per target slide and splices the new HTML in.
//
// Body: empty — the server reads draft comments from the DB. Stateless apply
// (passing comments in the body) is intentionally not supported in v1 so the
// only source of truth is the DB.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, user: { supabaseUserId: user.id } },
    include: {
      presentation: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } },
    },
  });
  if (!project || !project.presentation || !project.presentation.currentVersionId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const presentation = project.presentation;
  const sourceVersionId = presentation.currentVersionId!;

  const draftComments = await prisma.comment.findMany({
    where: {
      presentationId: presentation.id,
      versionId: sourceVersionId,
      status: "draft",
    },
    select: { id: true, slideId: true, content: true, boundsJson: true },
  });
  if (draftComments.length === 0) {
    return NextResponse.json(
      { error: "No draft comments to apply" },
      { status: 400 },
    );
  }

  // Distinct target slides. v1 has no `_global` scope, so this is just the
  // set of slide IDs referenced by drafts.
  const targetSlideIds = Array.from(
    new Set(draftComments.map((c) => c.slideId)),
  );

  // Allocate v_n+1 inside a transaction; retry on the
  // (presentationId, versionNumber) unique race the same way regenerate does.
  const MAX_ATTEMPTS = 3;
  let result: { newVersion: { id: string; versionNumber: number } } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const latest = await tx.presentationVersion.findFirst({
          where: { presentationId: presentation.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true, slideJson: true },
        });
        const nextNumber = (latest?.versionNumber ?? 0) + 1;
        const newVersion = await tx.presentationVersion.create({
          data: {
            presentationId: presentation.id,
            versionNumber: nextNumber,
            status: "queued",
            // Seed the new version with the source manifest. Partial regen
            // splices the regenerated slides INTO this copy; everything else
            // stays as it was. NOTE: we deliberately do NOT change
            // project.status here — partial regen keeps the deck visible
            // while a subset of slides is re-rendered. DeckView decides
            // per-slide overlays from the client-side `applyingState`.
            slideJson: toJson(latest?.slideJson ?? { status: "queued", slides: [] }),
          },
        });
        // Promote the drafts to applied AGAINST THE SOURCE VERSION. They
        // remain attached to the version they were authored against; the new
        // version starts clean (zero comments). Lock by id to avoid
        // marking a draft applied that someone deleted concurrently.
        await tx.comment.updateMany({
          where: {
            id: { in: draftComments.map((c) => c.id) },
            status: "draft",
          },
          data: { status: "applied" },
        });
        return { newVersion };
      });
      break;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "P2002" || attempt === MAX_ATTEMPTS - 1) throw error;
    }
  }
  if (!result) {
    return NextResponse.json(
      { error: "Failed to allocate a new presentation version" },
      { status: 500 },
    );
  }

  try {
    await sendInngestEventWithRetry({
      name: "deck.regenerate.partial.requested",
      data: {
        projectId: project.id,
        presentationId: presentation.id,
        versionId: result.newVersion.id,
        sourceVersionId,
        targetSlideIds,
        comments: draftComments.map((c) => ({
          slideId: c.slideId,
          content: c.content,
          boundsJson: c.boundsJson,
        })),
      },
    });
  } catch (error) {
    // Reverse the version allocation + applied transition so the user can
    // retry without losing their drafts.
    await prisma.presentationVersion
      .update({ where: { id: result.newVersion.id }, data: { status: "failed" } })
      .catch(() => undefined);
    await prisma.comment
      .updateMany({
        where: {
          id: { in: draftComments.map((c) => c.id) },
          status: "applied",
        },
        data: { status: "draft" },
      })
      .catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dispatch regenerate" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    versionId: result.newVersion.id,
    versionNumber: result.newVersion.versionNumber,
    targetSlideIds,
  });
}
