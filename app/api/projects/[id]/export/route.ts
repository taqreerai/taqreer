import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type ExportPayload = {
  format?: "pptx" | "pdf";
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function POST(
  request: Request,
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
  const body = (await request.json().catch(() => ({}))) as ExportPayload;
  const format = body.format === "pdf" ? "pdf" : "pptx";

  const project = await prisma.project.findFirst({
    where: {
      id,
      user: { supabaseUserId: user.id },
    },
    include: {
      presentation: {
        include: {
          versions: {
            where: { status: "completed" },
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const version = project.presentation.versions[0];
  if (!version) {
    return NextResponse.json(
      { error: "No completed presentation version found" },
      { status: 400 },
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const job = await prisma.job.create({
    data: {
      projectId: project.id,
      type: "deck.export",
      status: "queued",
      inputJson: toJson({ format, versionId: version.id }),
    },
  });

  try {
    await sendInngestEventWithRetry({
      name: "deck.export.requested",
      data: {
        projectId: project.id,
        versionId: version.id,
        jobId: job.id,
        userId: dbUser.id,
        format,
      },
    });
  } catch (error) {
    await prisma.job
      .update({
        where: { id: job.id },
        data: { status: "failed", outputJson: toJson({ error: String(error) }) },
      })
      .catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dispatch export" },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId: job.id });
}
