import { NextResponse } from "next/server";
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";

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

  await prisma.$transaction(async (tx) => {
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

    if (latestJob) {
      await tx.job.update({
        where: { id: latestJob.id },
        data: { status: "queued" },
      });
    }
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
        jobId: latestJob?.id,
        // Phase 16.D — actor for `deck.regen.{started,finished}`
        // self-echo skip in DeckView's broadcast handlers.
        actorPrismaUserId: access.user.prismaId,
        // Max-tier processing priority (see deck-generate `priority.run`).
        tier: await tierForUser(access.user.prismaId),
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
    if (latestJob) {
      await prisma.job
        .update({ where: { id: latestJob.id }, data: { status: "failed" } })
        .catch(() => undefined);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dispatch retry" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
