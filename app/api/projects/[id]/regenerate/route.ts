import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

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
    where: {
      id,
      user: { supabaseUserId: user.id },
    },
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
