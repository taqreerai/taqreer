// GET /api/projects/[id]/slides/[slideKey]/versions
//
// Returns the slide's version history newest-first, plus the
// SlideState pointer so the history popover can mark the current
// row. Used by the per-slide pill's "السجل" (History) button.
//
// Response:
//   {
//     currentVersionNumber: number | null,  // null when no SlideState exists
//     versions: [{ versionNumber, source, createdAt }, ...]
//   }
//
// Auth: Supabase user + project ownership check.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Phase 15.A — edit access required (history popover only shown
  // in edit UI).
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { presentation: { select: { id: true } } },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const state = await prisma.slideState.findUnique({
    where: {
      presentationId_slideKey: {
        presentationId: project.presentation.id,
        slideKey,
      },
    },
    select: {
      currentVersionNumber: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        select: {
          versionNumber: true,
          source: true,
          createdAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    currentVersionNumber: state?.currentVersionNumber ?? null,
    versions:
      state?.versions.map((v) => ({
        versionNumber: v.versionNumber,
        source: v.source,
        createdAt: v.createdAt.toISOString(),
      })) ?? [],
  });
}
