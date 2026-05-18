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
  // Live per-slide preview written by deck-generate's streaming parser
  // as Claude closes each slide object. Ephemeral — overwritten by the
  // canonical `slides` array when the full validation pass completes.
  // Each entry is a partial Slide that already passed SlideSchema +
  // contains the raw HTML (DeckView sanitises at render via the same
  // SlideRenderer path the canonical slides use).
  streamingPreview?: unknown[];
  // Theme JSON captured mid-stream (always streams before slides in
  // the manifest). Drives the CSS-var wiring on the live preview
  // slides so palette / fonts / background resolve correctly before
  // the final manifest validates.
  streamingTheme?: unknown;
  // Direction + language echoed from the brief so the live-preview
  // SlideRenderer doesn't assume RTL/Arabic.
  streamingDirection?: unknown;
  streamingLanguage?: unknown;
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
  // When the caller pinned to a specific versionId but no row matches,
  // return 404 — leaving the poller to spin forever with `versionId:
  // null` is ambiguous (the apply-poller can't tell "version was
  // never created" from "version not ready yet"). Failing fast lets
  // the disconnect detector pick this up immediately.
  if (targetVersionId && !latestVersion) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
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
  // Pass the live preview array through unchanged. Shape is asserted to
  // be an array; further validation happens at render time in DeckView.
  // Capped to a defensive 60 entries so a runaway parser can't blow up
  // the polling response.
  const streamingPreview = Array.isArray(slideJson?.streamingPreview)
    ? slideJson.streamingPreview.slice(0, 60)
    : null;
  const streamingTheme =
    slideJson?.streamingTheme && typeof slideJson.streamingTheme === "object"
      ? slideJson.streamingTheme
      : null;
  // String-narrow the direction + language to the two valid values
  // each accepts; anything else collapses to null and DeckView falls
  // back to its own default (which currently matches the brief's
  // hard-default of RTL/Arabic).
  const streamingDirection =
    slideJson?.streamingDirection === "rtl" || slideJson?.streamingDirection === "ltr"
      ? slideJson.streamingDirection
      : null;
  const streamingLanguage =
    slideJson?.streamingLanguage === "ar" || slideJson?.streamingLanguage === "en"
      ? slideJson.streamingLanguage
      : null;

  return NextResponse.json({
    status: inferredStatus,
    slideCount,
    progress,
    streamingPreview,
    streamingTheme,
    streamingDirection,
    streamingLanguage,
    // Latest version id + its own status. DeckView's partial-regen polling
    // uses this to distinguish "applying is done" (versionId == the new
    // version's id AND status=completed) from "you're still looking at the
    // pre-apply version" (versionId == source).
    versionId: latestVersion?.id ?? null,
    versionStatus: latestVersion?.status ?? null,
  });
}
