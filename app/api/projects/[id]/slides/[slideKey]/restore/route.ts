// POST /api/projects/[id]/slides/[slideKey]/restore
//
// Body: { versionNumber: number }
//
// Jumps the slide's pointer to `versionNumber` and splices that
// version's slideJson into the active manifest. NON-destructive —
// other history rows stay intact, the user can hop between any of
// them via the History popover.
//
// Returns 400 if the version doesn't exist for this slide.
// Returns 200 with the new active slide JSON + currentVersionNumber.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { restoreSlideToVersion } from "@/lib/db/slide-versioning";

type RestorePayload = {
  versionNumber?: number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body = (await request.json().catch(() => ({}))) as RestorePayload;
  const targetVersionNumber = body.versionNumber;
  if (
    typeof targetVersionNumber !== "number" ||
    !Number.isInteger(targetVersionNumber) ||
    targetVersionNumber < 1
  ) {
    return NextResponse.json(
      { error: "versionNumber must be a positive integer" },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { presentation: { select: { id: true } } },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = await restoreSlideToVersion(
    prisma,
    project.presentation.id,
    slideKey,
    targetVersionNumber,
  );
  if (!result) {
    return NextResponse.json(
      { error: "Version not found for this slide" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    currentVersionNumber: result.currentVersionNumber,
    slide: result.slide,
  });
}
