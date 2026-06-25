import { NextResponse } from "next/server";
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import type { Prisma } from "@prisma/client";

type RetryPayload = {
  type?: string;
  enhance?: unknown;
  brief?: unknown;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      presentation: {
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.status !== "failed") {
    return NextResponse.json({ error: "Project is not in a failed state" }, { status: 400 });
  }

  const latestVersion = project.presentation.versions[0];
  const latestJob = project.jobs[0];
  const inputJson = (latestJob?.inputJson ?? {}) as RetryPayload;

  // Mint a FRESH job rather than re-queueing the failed one. The credit
  // hold keys on jobId (deck-generate's holdCredits), so reusing the
  // settled job's id made the worker treat the released hold as "already
  // held", debit nothing, and run the retry for free. A new jobId forces a
  // real hold (debit + a fresh balance check via takeFunds), which settles
  // the actual cost on success and releases on failure, so a retry is
  // billed exactly like a first attempt and never runs free.
  const retryJob = await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: project.id },
      data: { status: "queued" },
    });

    if (latestVersion) {
      await tx.presentationVersion.update({
        where: { id: latestVersion.id },
        data: { status: "queued" },
      });
    }

    return tx.job.create({
      data: {
        projectId: project.id,
        type: latestJob?.type ?? "deck.generate",
        status: "queued",
        inputJson: (latestJob?.inputJson ?? {}) as Prisma.InputJsonValue,
      },
    });
  });

  try {
    await sendInngestEventWithRetry({
      name: "deck.generate.requested",
      data: {
        // Spread original inputJson FIRST so the explicit IDs below
        // win the merge. The old order let a stale / tampered
        // `inputJson.projectId` (etc.) shadow the canonical project
        // ID we just resolved, sending the regen to the wrong place.
        ...inputJson,
        projectId: project.id,
        presentationId: project.presentation.id,
        versionId: latestVersion?.id,
        jobId: retryJob.id,
        // Phase 16.D — actor for `deck.regen.{started,finished}`
        // self-echo skip in DeckView's broadcast handlers.
        actorPrismaUserId: access.user.prismaId,
        // Max-tier processing priority is the project OWNER's entitlement (they
        // are billed for the run), so read the owner's tier, not the actor's.
        tier: await tierForUser(access.project.user.id),
      },
    });
  } catch (error) {
    // Send failed after retries — revert the just-set "queued" statuses so
    // the project doesn't appear stuck. Caller sees 500.
    await prisma.project
      .update({ where: { id: project.id }, data: { status: "failed" } })
      .catch(() => undefined);
    if (latestVersion) {
      await prisma.presentationVersion
        .update({ where: { id: latestVersion.id }, data: { status: "failed" } })
        .catch(() => undefined);
    }
    await prisma.job
      .update({ where: { id: retryJob.id }, data: { status: "failed" } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dispatch retry" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
