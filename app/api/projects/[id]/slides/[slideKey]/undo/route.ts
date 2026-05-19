// POST /api/projects/[id]/slides/[slideKey]/undo
//
// Steps the slide back one version: DELETES the current
// SlideVersion row, moves SlideState.currentVersionNumber to the
// next-lower versionNumber, and splices that older version's
// slideJson into the active PresentationVersion so the renderer
// shows it immediately.
//
// Per product spec — undo discards the unwanted version entirely
// (no "redo" path). Restore-from-History is the non-destructive
// alternative for stepping between known checkpoints.
//
// Returns 400 if there's nothing to undo (slide at v1, or no
// SlideState exists). 200 with the new active slide JSON otherwise.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { undoSlideVersion } from "@/lib/db/slide-versioning";

export async function POST(
  _request: Request,
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    include: { presentation: { select: { id: true } } },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = await undoSlideVersion(
    prisma,
    project.presentation.id,
    slideKey,
  );
  if (!result) {
    return NextResponse.json(
      { error: "Nothing to undo for this slide" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    currentVersionNumber: result.currentVersionNumber,
    slide: result.slide,
  });
}
