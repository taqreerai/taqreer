// POST /api/projects/[id]/slides/[slideKey]/checkpoint
//
// Creates a history CHECKPOINT for one slide: snapshots its CURRENT active
// content (already persisted in place by /edit) as a new SlideVersion + bumps
// the pointer. No body — the content is read from the live manifest.
//
// This is the deliberate-history path. Edits no longer create a version per
// keystroke (that's /edit → updateSlideContentInPlace, in place, no history);
// instead the client calls this on SAVE and on a 10-minute idle autosave, so
// the version log / History popover stays coarse and undo/redo (a client-side
// stack) stays accurate.
//
// No-op (200, unchanged version) when nothing changed since the last checkpoint.
// 404 if the project/slide is gone, 200 with { currentVersionNumber, slide }.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { recordSlideCheckpoint } from "@/lib/db/slide-versioning";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Edit access required (mirrors the edit / restore routes).
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { presentation: { select: { id: true } } },
  });
  if (!project?.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let result;
  try {
    result = await recordSlideCheckpoint(
      prisma,
      project.presentation.id,
      slideKey,
    );
  } catch (err) {
    console.error("[slides/checkpoint] recordSlideCheckpoint failed:", err);
    return NextResponse.json(
      { error: "Failed to checkpoint" },
      { status: 500 },
    );
  }
  if (!result) {
    return NextResponse.json(
      { error: "Slide not found in this deck" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    currentVersionNumber: result.currentVersionNumber,
    slide: result.slide,
  });
}
