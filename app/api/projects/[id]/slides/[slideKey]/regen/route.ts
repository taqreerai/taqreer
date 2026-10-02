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
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import {
  allocateNextVersionInTx,
  regenCreditGate,
  retryOnP2002,
  rollbackVersionAndJob,
  toJson,
} from "@/lib/api/regen-helpers";
import { regenCost } from "@/lib/credits/cost";
import {
  creditCostFor,
  ensureFresh,
  getRegenBaseCredits,
  regenPresetFor,
} from "@/lib/config/runtime-config";

type RegenPayload = { replay?: boolean };
type CachedComment = {
  slideId: string;
  content: string;
  boundsJson: unknown;
};

// Parse + validate the optional `{ replay?: boolean }` body. Three
// distinct outcomes the legacy `request.json().catch(() => ({}))`
// pattern conflated: empty body (legacy clean regen) → defaults to
// `replay: false`; malformed JSON → 400; non-object payload or
// wrong-typed `replay` → 400. Same contract as the lock route.
type ParsedBody =
  | { ok: true; replay: boolean }
  | { ok: false; error: string };

function parseRegenBody(rawText: string): ParsedBody {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return { ok: true, replay: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const body = parsed as RegenPayload;
  if (body.replay !== undefined && typeof body.replay !== "boolean") {
    return { ok: false, error: "replay must be a boolean" };
  }
  return { ok: true, replay: body.replay === true };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  // Body is OPTIONAL — most callers fire `{ replay: false }` and the
  // legacy clean-regen path omits the body entirely. See
  // `parseRegenBody` for the four-way contract.
  const parsedBody = parseRegenBody(await request.text());
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: 400 });
  }
  const replay = parsedBody.replay;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      user: { select: { role: true, plan: true } },
      presentation: {
        select: { id: true, currentVersionId: true },
      },
    },
  });
  // Regens INHERIT the deck's original generation preset (premium decks keep
  // premium design quality on regenerated slides, priced on the same key);
  // deactivated/legacy keys fall back to the fastest active no-thinking
  // preset. Resolved LIVE so it follows admin Settings.
  await ensureFresh();
  const genJob = await prisma.job.findFirst({
    where: { projectId, type: "deck.generate", status: "succeeded" },
    orderBy: { createdAt: "desc" },
    select: { quality: true },
  });
  const originalQuality = regenPresetFor(genJob?.quality);
  if (
    !project ||
    !project.presentation ||
    !project.presentation.currentVersionId
  ) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const presentation = project.presentation;
  const sourceVersionId = presentation.currentVersionId;

  // ── Credit pre-check (UX-forward gate) ─────────────────────────────
  // The worker holds regenCost(preset, 1) against the OWNER and throws
  // NonRetriableError on an insufficient balance, which surfaces only as a
  // generic failed version. Gate here, before allocating a version, so the studio
  // opens the credit gate synchronously. This route always targets one slide.
  // The worker hold stays the authoritative backstop.
  const regenGate = await regenCreditGate({
    ownerId: project.userId,
    ownerRole: project.user?.role ?? "user",
      ownerPlan: project.user?.plan ?? null,
    cost: regenCost(originalQuality, 1, creditCostFor, getRegenBaseCredits()),
  });
  if (regenGate) return NextResponse.json(regenGate, { status: 402 });

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

  // Allocate a new PresentationVersion seeded from the latest one.
  // The (presentationId, versionNumber) unique index can race with a
  // concurrent regen; `retryOnP2002` recovers from the collision.
  let newVersion: { id: string; versionNumber: number };
  try {
    newVersion = await retryOnP2002(() =>
      prisma.$transaction((tx) =>
        // `?? undefined`: the 404 guard above makes currentVersionId
        // non-null here, but the narrowing doesn't survive the alias.
        allocateNextVersionInTx(tx, presentation.id, sourceVersionId ?? undefined),
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to allocate a new presentation version" },
      { status: 500 },
    );
  }

  // Job row + Inngest dispatch. A failure at either step rolls back
  // the version + job to "failed" so the user can retry without
  // stranded state.
  let regenJobId: string | null = null;
  try {
    const regenJob = await prisma.job.create({
      data: {
        project: { connect: { id: project.id } },
        type: "deck.regenerate.partial",
        status: "queued",
        // `toJson` round-trip preserved here — `inputJson` is a
        // Prisma `Json` column, and the typed literal needs the
        // explicit narrowing helper to satisfy `InputJsonValue`.
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
        // Phase 16.D — actor for `slide.regen.{started,finished}`
        // self-echo skip in DeckView's broadcast handlers.
        actorPrismaUserId: access.user.prismaId,
        // Max-tier processing priority is the project OWNER's entitlement (they
        // are billed for the run), so read the owner's tier, not the actor's.
        tier: await tierForUser(access.project.user.id),
      },
    });
  } catch (error) {
    await rollbackVersionAndJob({
      versionId: newVersion.id,
      jobId: regenJobId,
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
    targetSlideIds: [slideKey],
  });
}
