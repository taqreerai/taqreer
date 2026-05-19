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
import { createClient } from "@/lib/supabase/server";

export async function GET(
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
