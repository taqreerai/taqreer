import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Phase 15.A: edit access required. Owner + accepted edit-share
  // pass; comment / view / public-view users get 403.
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
      { error: "No prior generation found to regenerate from" },
      { status: 400 },
    );
  }
  const eventPayload = (latestJob.inputJson ?? {}) as Record<string, unknown>;

  // Compute the next version number inside the transaction and retry on
  // unique-constraint races (PresentationVersion(presentationId, versionNumber)).
  // Without this, two concurrent regenerate calls can both read the same
  // latestVersionNumber and try to create v_n+1 twice.
  const MAX_ATTEMPTS = 3;
  let result: { newVersion: { id: string; versionNumber: number }; newJob: { id: string } } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const latest = await tx.presentationVersion.findFirst({
          where: { presentationId: project.presentation!.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        const nextNumber = (latest?.versionNumber ?? 0) + 1;
        const newVersion = await tx.presentationVersion.create({
          data: {
            presentationId: project.presentation!.id,
            versionNumber: nextNumber,
            status: "queued",
            slideJson: toJson({ status: "queued", slides: [] }),
          },
        });
        await tx.presentation.update({
          where: { id: project.presentation!.id },
          data: { currentVersionId: newVersion.id },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { status: "queued" },
        });
        const newJob = await tx.job.create({
          data: {
            projectId: project.id,
            type: "deck.generate",
            status: "queued",
            inputJson: toJson(eventPayload),
          },
        });
        return { newVersion, newJob };
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
      name: "deck.generate.requested",
      data: {
        ...eventPayload,
        projectId: project.id,
        presentationId: project.presentation.id,
        versionId: result.newVersion.id,
        jobId: result.newJob.id,
        // Phase 16.D — actor for `deck.regen.{started,finished}`
        // self-echo skip in DeckView's broadcast handlers.
        actorPrismaUserId: access.user.prismaId,
        // Max-tier processing priority (see deck-generate `priority.run`).
        tier: await tierForUser(access.user.prismaId),
      },
    });
  } catch (error) {
    await prisma.project
      .update({ where: { id: project.id }, data: { status: "failed" } })
      .catch(() => undefined);
    await prisma.presentationVersion
      .update({ where: { id: result.newVersion.id }, data: { status: "failed" } })
      .catch(() => undefined);
    await prisma.job
      .update({ where: { id: result.newJob.id }, data: { status: "failed" } })
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
  });
}
