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
  request: Request,
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
  // Optional ?versionId= — when provided, the poller wants the status of
  // a SPECIFIC version (e.g. the partial-regen target). Without it, two
  // close-together partial regens could let `take: 1` mask completion of
  // the version the client is actually waiting on.
  const targetVersionId = new URL(request.url).searchParams.get("versionId");
  const versionsQuery = targetVersionId
    ? {
        where: { id: targetVersionId },
        take: 1,
        select: { id: true, status: true, slideJson: true },
      }
    : {
        orderBy: { versionNumber: "desc" as const },
        take: 1,
        select: { id: true, status: true, slideJson: true },
      };
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
          versions: versionsQuery,
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
    // Latest version id + its own status. DeckView's partial-regen polling
    // uses this to distinguish "applying is done" (versionId == the new
    // version's id AND status=completed) from "you're still looking at the
    // pre-apply version" (versionId == source).
    versionId: latestVersion?.id ?? null,
    versionStatus: latestVersion?.status ?? null,
  });
}
