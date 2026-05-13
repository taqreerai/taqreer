import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type Progress = {
  stage: "thinking" | "designing" | "validating" | "saving";
  currentSlide: number;
  estimatedTotal: number;
};

type SlideJson = {
  status?: string;
  slides?: unknown[];
  progress?: Progress;
};

function getSlideJson(value: unknown): SlideJson | null {
  if (!value || typeof value !== "object") return null;
  return value as SlideJson;
}

function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stage === "string" &&
    typeof v.currentSlide === "number" &&
    typeof v.estimatedTotal === "number"
  );
}

export async function GET(
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
    select: {
      status: true,
      presentation: {
        select: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              status: true,
              slideJson: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const latestVersion = project.presentation?.versions[0];
  const slideJson = getSlideJson(latestVersion?.slideJson);
  const slideCount = Array.isArray(slideJson?.slides) ? slideJson.slides.length : 0;
  const inferredStatus =
    project.status === "failed"
      ? "failed"
      : project.status === "complete" || project.status === "completed"
        ? project.status
        : latestVersion?.status === "completed" || slideJson?.status === "complete"
          ? "complete"
          : project.status;

  const progress = isProgress(slideJson?.progress) ? slideJson.progress : null;

  return NextResponse.json({
    status: inferredStatus,
    slideCount,
    progress,
  });
}
