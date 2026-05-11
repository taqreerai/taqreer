import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type RetryPayload = {
  type?: string;
  enhance?: unknown;
  brief?: unknown;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
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
      user: {
        supabaseUserId: user.id,
      },
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

  await inngest.send({
    name: "deck.generate.requested",
    data: {
      projectId: project.id,
      presentationId: project.presentation.id,
      versionId: latestVersion?.id,
      jobId: latestJob?.id,
      ...inputJson,
    },
  });

  return NextResponse.json({ ok: true });
}
