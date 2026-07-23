// POST /api/projects/[id]/unlock
//
// Teaser paywall (free-tier conversion). A free `create` deck is authored as a
// longer deck of which only the first N slides render; the withheld tail shows
// blurred + locked in the viewer. This endpoint fires the COMPED generation of
// those withheld slides on Opus once the owner is on a paid plan.
//
// Body: empty. The withheld count + source live on the deck. Guards:
//   - caller must be the OWNER (admin bypass counts as owner) - not a shared
//     collaborator (this is a billing-adjacent action on the owner's deck).
//   - the deck must still be a locked teaser (teaserLockedCount > 0) and not
//     already unlocked (teaserUnlockedAt == null) - idempotent.
//   - the OWNER must be on a paid plan (or admin). A free owner gets a 402 so
//     the studio opens the UpgradeModal; the unlock fires on subscribe success.
// The unlock is COMPED (no credit hold/settle) - it is the conversion reward.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { toJson } from "@/lib/api/regen-helpers";
import { isPaidPlan } from "@/lib/plan";

// Lowest Opus preset every paid tier affords (plus+ all unlock opus-fast).
// Matches the pinned regen preset. The unlocked tail is crafted on Opus even
// for a Plus subscriber, which is the upsell the tease promises.
const UNLOCK_PRESET = "opus-fast";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Require edit access, then narrow to OWNER (admin bypass resolves to
  // "owner"). A shared editor/commenter cannot unlock someone else's deck.
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can unlock" }, { status: 403 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      teaserLockedCount: true,
      teaserUnlockedAt: true,
      user: { select: { id: true, plan: true, role: true } },
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
  const sourceVersionId = presentation.currentVersionId!;

  // Not a teaser, or already unlocked → nothing to do. Idempotent: a double
  // click (or a reload-then-click) is a no-op, not a second generation.
  if (project.teaserLockedCount <= 0 || project.teaserUnlockedAt != null) {
    return NextResponse.json({ ok: true, alreadyUnlocked: true });
  }

  // Paid gate on the OWNER (admins comped). A free owner gets a 402 so the
  // studio opens the UpgradeModal; the client re-fires this endpoint after a
  // successful subscribe.
  const ownerPaid =
    isPaidPlan(project.user.plan) || project.user.role === "admin";
  if (!ownerPaid) {
    return NextResponse.json({ error: "upgrade_required" }, { status: 402 });
  }

  // Don't double-dispatch: if an unlock job is already in flight (e.g. a
  // reload-then-click before the first finished), report success and let the
  // running job land.
  const inFlight = await prisma.job.findFirst({
    where: {
      projectId: id,
      type: "deck.unlock",
      status: { in: ["queued", "processing", "running"] },
    },
    select: { id: true },
  });
  if (inFlight) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  let jobId: string | null = null;
  try {
    const job = await prisma.job.create({
      data: {
        project: { connect: { id: project.id } },
        type: "deck.unlock",
        status: "queued",
        inputJson: toJson({
          sourceVersionId,
          lockedCount: project.teaserLockedCount,
          quality: UNLOCK_PRESET,
        }),
        quality: UNLOCK_PRESET,
      },
    });
    jobId = job.id;
    await sendInngestEventWithRetry({
      name: "deck.unlock.requested",
      data: {
        projectId: project.id,
        presentationId: presentation.id,
        sourceVersionId,
        lockedCount: project.teaserLockedCount,
        quality: UNLOCK_PRESET,
        jobId: job.id,
        actorPrismaUserId: access.user.prismaId,
        // Processing priority follows the OWNER's tier (they own the deck).
        tier: await tierForUser(project.user.id),
      },
    });
  } catch (error) {
    // Best-effort rollback of the telemetry job so a retry is clean.
    if (jobId) {
      await prisma.job
        .delete({ where: { id: jobId } })
        .catch(() => undefined);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to dispatch unlock",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
