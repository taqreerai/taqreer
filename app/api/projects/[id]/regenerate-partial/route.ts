// POST /api/projects/[id]/regenerate-partial
//
// Apply the user's draft comments by:
//   1. promoting them to status="applied" (so they can't be edited / re-fired)
//   2. allocating a new PresentationVersion (v_n+1) as a copy of the current
//   3. dispatching `deck.regenerate.partial.requested` to Inngest, which calls
//      Claude per target slide and splices the new HTML in.
//
// Body: empty — the server reads draft comments from the DB. Stateless apply
// (passing comments in the body) is intentionally not supported in v1 so the
// only source of truth is the DB.

import { NextResponse } from "next/server";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { edbg } from "@/lib/debug/editor-debug";
import {
  allocateNextVersionInTx,
  getOriginalQuality,
  retryOnP2002,
  rollbackVersionAndJob,
  toJson,
  type RegenTx,
} from "@/lib/api/regen-helpers";

// Promoted comment shape returned from the snapshot tx — what the
// Inngest dispatch ships to the worker.
type Promoted = {
  id: string;
  slideId: string;
  content: string;
  boundsJson: unknown;
};
// Discriminated union for the snapshot-tx result. `empty` covers two
// legitimate "no work to do" paths (no drafts at request time, or a
// concurrent apply won the race and promoted every draft we saw);
// caller surfaces both as a 400 with the same message.
type TxResult =
  | { kind: "empty" }
  | {
      kind: "ok";
      promoted: Promoted[];
      newVersion: { id: string; versionNumber: number };
    };

/**
 * Atomic snapshot + promote: read drafts, allocate v_n+1, promote
 * the read drafts to "applied" inside the same transaction. The
 * returned `promoted` rows are the exact set we dispatch to Inngest
 * — no drift window between the read snapshot and the emitted
 * payload (CR #25 #3 / #4). Wrapped in `retryOnP2002` for the
 * (presentationId, versionNumber) unique-index race; that's a
 * transient retry-able failure, not a logical conflict.
 */
async function runSnapshotAndPromoteTx(args: {
  presentationId: string;
  sourceVersionId: string;
}): Promise<TxResult> {
  const { presentationId, sourceVersionId } = args;
  return retryOnP2002(() =>
    prisma.$transaction(async (tx: RegenTx) => {
      const drafts = await tx.comment.findMany({
        where: {
          presentationId,
          versionId: sourceVersionId,
          status: "draft",
          // Only AI comments are fed to the model + promoted. Normal
          // user/collaboration comments (forAi=false) stay as drafts —
          // they're for other people on the share link, never sent to
          // Claude (§16, Chunk 4). Downstream promote/re-read key off
          // these ids, so this single filter scopes the whole apply.
          forAi: true,
        },
        select: { id: true, slideId: true, content: true, boundsJson: true },
      });
      edbg("server:partial-regen", "gathered AI (forAi) drafts", {
        count: drafts.length,
        slides: Array.from(new Set(drafts.map((d) => d.slideId))),
      });
      if (drafts.length === 0) return { kind: "empty" as const };

      const newVersion = await allocateNextVersionInTx(tx, presentationId);

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

      // Carry the REMAINING draft comments forward onto the new version. Only
      // AI (forAi) comments were promoted to "applied" above; the user /
      // collaboration comments are still "draft" on the source version. After
      // this regen completes the current-version pointer moves to newVersion,
      // so without re-pointing them the user comments would vanish from view
      // even though only the AI comment was applied (§16 Chunk 4 — user-vs-AI
      // split; reported 2026-06-07).
      await tx.comment.updateMany({
        where: {
          presentationId,
          versionId: sourceVersionId,
          status: "draft",
        },
        data: { versionId: newVersion.id },
      });
      return { kind: "ok" as const, promoted, newVersion };
    }),
  );
}

/**
 * Dedupe the slide IDs touched by the promoted comments. A single
 * slide can carry multiple comments; the partial-regen function
 * regenerates each slide once.
 */
function uniqueSlideIds(promoted: ReadonlyArray<Promoted>): string[] {
  return Array.from(new Set(promoted.map((c) => c.slideId)));
}

/**
 * Local rollback shim — calls the shared `rollbackVersionAndJob` AND
 * un-promotes the comment rows back to "draft" so the user can retry
 * without losing their drafts. Best-effort; per-row blips don't
 * propagate.
 */
async function rollbackPartialRegen(args: {
  versionId: string;
  jobId: string | null;
  promotedIds: string[];
}): Promise<void> {
  await Promise.allSettled([
    rollbackVersionAndJob({ versionId: args.versionId, jobId: args.jobId }),
    prisma.comment.updateMany({
      where: { id: { in: args.promotedIds }, status: "applied" },
      data: { status: "draft" },
    }),
  ]);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      presentation: { select: { id: true, currentVersionId: true } },
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
  // TS can't carry the `if (!presentation.currentVersionId)` narrow
  // through the `const presentation = ...` aliasing — guard above
  // already guarantees non-null. Same pattern as the sibling regen
  // route.
  const sourceVersionId = presentation.currentVersionId!;

  let result: TxResult;
  try {
    result = await runSnapshotAndPromoteTx({
      presentationId: presentation.id,
      sourceVersionId,
    });
  } catch {
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
  const targetSlideIds = uniqueSlideIds(promoted);
  const originalQuality = await getOriginalQuality(project.id);

  // Job row + Inngest dispatch. A failure at either step rolls back
  // the version, the comment promotions, AND (if it got created) the
  // telemetry Job row — so the user can retry without losing drafts.
  // Previously Job.create sat OUTSIDE the catch — when it threw
  // (e.g. Prisma XOR rejection on a newly-added scalar), the 500
  // left the comment stranded in "applied" and version 2 stranded
  // in "queued" with no Inngest run.
  //
  // `project: { connect }` is the strict relation form. Raw
  // `projectId` (unchecked FK form) mixed with the scalar columns
  // (`quality`, etc.) flips Prisma's XOR resolution to
  // JobCreateInput-strict at runtime and rejects `projectId` as
  // "unknown argument".
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
          targetSlideIds,
          commentCount: promoted.length,
          quality: originalQuality,
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
        targetSlideIds,
        comments: promoted.map((c) => ({
          slideId: c.slideId,
          content: c.content,
          boundsJson: c.boundsJson,
        })),
        quality: originalQuality,
        jobId: regenJob.id,
        // Phase 16.D — actor for `slide.regen.{started,finished}`
        // self-echo skip in DeckView's broadcast handlers.
        actorPrismaUserId: access.user.prismaId,
      },
    });
  } catch (error) {
    await rollbackPartialRegen({
      versionId: newVersion.id,
      jobId: regenJobId,
      promotedIds: promoted.map((c) => c.id),
    });
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
    targetSlideIds,
  });
}
