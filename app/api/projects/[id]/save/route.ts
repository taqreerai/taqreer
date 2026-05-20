// POST /api/projects/[id]/save
//
// Pins the project's currently-rendered PresentationVersion as
// the "saved" canonical snapshot (Presentation.savedVersionId).
// The Save button on the preview toolbar fires this on every
// click; idempotent — re-saving an already-saved version is a
// no-op aside from the timestamp bump on Project.updatedAt.
//
// `Project.slideCount` + `Project.dominantColor` are NOT touched
// here — they're frozen on the FIRST successful deck-generate
// completion (see inngest/functions/deck-generate.ts save-to-database
// step). Save is a snapshot-pointer move, not a metadata capture.
//
// Dispatches the thumbnail render Inngest job after the pointer +
// per-slide snapshot land.
//
// Auth: Supabase user + project ownership check.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

type SaveResponse =
  | {
      ok: true;
      savedVersionId: string;
      // Per-slide content snapshot taken at save time. Mirrors the
      // Presentation.savedSlideVersions column the route just wrote;
      // returned in the body so DeckView can update its local
      // comparison map without a router.refresh round-trip.
      savedSlideVersions: Record<string, number>;
    }
  | { error: string };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<SaveResponse>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    select: {
      id: true,
      presentation: {
        select: {
          id: true,
          currentVersionId: true,
          savedVersionId: true,
        },
      },
    },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const currentVersionId = project.presentation.currentVersionId;
  if (!currentVersionId) {
    return NextResponse.json(
      { error: "No current version to save" },
      { status: 400 },
    );
  }

  // Per-slide snapshot — { slideKey → SlideState.currentVersionNumber }.
  // Needed because per-slide restore mutates PresentationVersion.slideJson
  // in place WITHOUT bumping currentVersionId (see lib/db/slide-
  // versioning.ts:spliceSlideIntoActiveManifest), so the saved/unsaved
  // indicator can't rely on the version pointer alone — it has to compare
  // each live slide's currentVersionNumber against this snapshot. Empty
  // map for legacy projects with no SlideState rows yet; the comparator
  // in DeckView treats an empty snapshot as a no-op (PresentationVersion
  // pointer is then the only signal).
  const slideStates = await prisma.slideState.findMany({
    where: { presentationId: project.presentation.id },
    select: { slideKey: true, currentVersionNumber: true },
  });
  const savedSlideVersions: Record<string, number> = {};
  for (const s of slideStates) {
    savedSlideVersions[s.slideKey] = s.currentVersionNumber;
  }

  await prisma.presentation.update({
    where: { id: project.presentation.id },
    data: {
      savedVersionId: currentVersionId,
      savedSlideVersions: savedSlideVersions as Prisma.InputJsonValue,
    },
  });

  // Fire-and-forget thumbnail render — the Inngest function loads
  // the saved manifest, drives Puppeteer to screenshot each slide,
  // uploads WebPs to the `slide-previews` bucket, and writes the
  // resulting URL list into Project.thumbnailUrls. Failures don't
  // block the save round-trip; dashboard tiles fall back to a
  // placeholder when thumbnailUrls is empty.
  //
  // Inngest dedupes events sharing the same `id` within a short
  // window, so two rapid Save clicks on the same version don't
  // queue two identical renders.
  await inngest
    .send({
      id: `thumbnails:${project.id}:${currentVersionId}`,
      name: "deck.thumbnails.render",
      data: {
        projectId: project.id,
        savedVersionId: currentVersionId,
      },
    })
    .catch((err) => {
      // Don't fail the Save — log and move on. The thumbnail
      // pipeline is best-effort; the canonical version pointer
      // landed in the same transaction above.
      console.error("[save] inngest.send(deck.thumbnails.render) failed:", err);
    });

  return NextResponse.json({
    ok: true,
    savedVersionId: currentVersionId,
    savedSlideVersions,
  });
}
