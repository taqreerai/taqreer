import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isQuality, type Quality } from "@/lib/types/quality";

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

  // Atomic snapshot + promote: read drafts, allocate v_n+1, and promote
  // the read drafts to "applied" INSIDE the same transaction. The
  // returned `promoted` rows are the exact set we dispatch to Inngest —
  // no drift window between the read snapshot and the emitted payload
  // (CR #25 #3 / #4). Retry the whole tx on the (presentationId,
  // versionNumber) unique-index race; that's a transient retry-able
  // failure, not a logical conflict.
  type Promoted = {
    id: string;
    slideId: string;
    content: string;
    boundsJson: unknown;
  };
  type TxResult =
    | { kind: "empty" }
    | {
        kind: "ok";
        promoted: Promoted[];
        newVersion: { id: string; versionNumber: number };
      };

  const MAX_ATTEMPTS = 3;
  let result: TxResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const drafts = await tx.comment.findMany({
          where: {
            presentationId: presentation.id,
            versionId: sourceVersionId,
            status: "draft",
          },
          select: { id: true, slideId: true, content: true, boundsJson: true },
        });
        if (drafts.length === 0) return { kind: "empty" as const };

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
        // Promote the drafts. The `status: "draft"` guard means concurrent
        // deletions / concurrent applies show up as `count < drafts.length`.
        // If `count === 0` another request fully won the race — every draft
        // we saw was already promoted by another in-flight apply — so we
        // bail to avoid dispatching a duplicate regenerate event for the
        // same rows.
        const updated = await tx.comment.updateMany({
          where: {
            id: { in: drafts.map((c) => c.id) },
            status: "draft",
          },
          data: { status: "applied" },
        });
        if (updated.count === 0) return { kind: "empty" as const };
        // Re-read the promoted rows so the dispatched snapshot is exactly
        // what's now in `applied` state — current content, no rows that
        // vanished between findMany and updateMany.
        const promoted = await tx.comment.findMany({
          where: {
            id: { in: drafts.map((c) => c.id) },
            status: "applied",
          },
          select: { id: true, slideId: true, content: true, boundsJson: true },
        });
        if (promoted.length === 0) return { kind: "empty" as const };
        return { kind: "ok" as const, promoted, newVersion };
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
  if (result.kind === "empty") {
    return NextResponse.json(
      { error: "No draft comments to apply" },
      { status: 400 },
    );
  }

  const { promoted, newVersion } = result;
  const targetSlideIds = Array.from(new Set(promoted.map((c) => c.slideId)));

  // Look up the original deck's quality preset from the most recent
  // successful generation job for this project. Forwarded to the
  // partial-regen function so the single-slide redesign uses the SAME
  // model + thinking the user picked when generating — without it
  // every regen burned Opus tier regardless of the user's fast/medium
  // choice. Falls through to `medium` (paramsForQuality default) when
  // no successful job exists or the field is missing on older jobs.
  const lastJob = await prisma.job.findFirst({
    where: { projectId: project.id, type: "deck.generate", status: "succeeded" },
    orderBy: { createdAt: "desc" },
    select: { inputJson: true },
  });
  const lastInput = (lastJob?.inputJson ?? null) as { quality?: unknown } | null;
  const originalQuality: Quality | null = isQuality(lastInput?.quality)
    ? lastInput.quality
    : null;

  try {
    await sendInngestEventWithRetry({
      name: "deck.regenerate.partial.requested",
      data: {
        projectId: project.id,
        presentationId: presentation.id,
        versionId: newVersion.id,
        sourceVersionId,
        targetSlideIds,
        comments: promoted.map((c) => ({
          slideId: c.slideId,
          content: c.content,
          boundsJson: c.boundsJson,
        })),
        quality: originalQuality,
      },
    });
  } catch (error) {
    // Reverse the version allocation + applied transition so the user can
    // retry without losing their drafts.
    await prisma.presentationVersion
      .update({ where: { id: newVersion.id }, data: { status: "failed" } })
      .catch(() => undefined);
    await prisma.comment
      .updateMany({
        where: {
          id: { in: promoted.map((c) => c.id) },
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
    versionId: newVersion.id,
    versionNumber: newVersion.versionNumber,
    targetSlideIds,
  });
}
