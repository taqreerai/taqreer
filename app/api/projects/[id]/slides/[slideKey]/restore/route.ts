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
import { createClient } from "@/lib/supabase/server";
import { restoreSlideToVersion } from "@/lib/db/slide-versioning";

type RestorePayload = {
  versionNumber?: number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, slideKey } = await params;
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
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
