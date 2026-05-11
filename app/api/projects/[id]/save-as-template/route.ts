import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type SaveAsTemplatePayload = {
  title?: string;
  category?: string;
  industry?: string;
  language?: string;
  isPublic?: boolean;
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
  const body = (await request.json().catch(() => ({}))) as SaveAsTemplatePayload;

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
    select: { id: true, plan: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const meta = {
    name: body.title?.trim() || project.title,
    category: body.category?.trim() || "general",
    industry: body.industry?.trim() || "general",
    language: body.language?.trim() || project.language,
    isPublic: Boolean(body.isPublic),
  };

  const job = await prisma.job.create({
    data: {
      projectId: project.id,
      type: "template.save",
      status: "queued",
      inputJson: toJson({ versionId: version.id, meta }),
    },
  });

  await inngest.send({
    name: "template.save.requested",
    data: {
      versionId: version.id,
      userId: dbUser.id,
      jobId: job.id,
      meta,
    },
  });

  return NextResponse.json({ jobId: job.id });
}
