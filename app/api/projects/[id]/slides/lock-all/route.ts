// POST /api/projects/[id]/slides/lock-all
//
// Bulk lock / unlock every slide in the deck. Driven by the
// "Lock all" / "Unlock all" pill at the bottom of SlideNavSidebar.
// One round-trip vs. N per-slide calls — important when a deck has
// 15-20 slides and the user just wants to freeze the whole thing
// before exporting.
//
// Body: { locked: boolean }
// Returns: { ok: true, count: number }
//
// Semantics mirror the single-slide lock route:
//   locked=true   → set lockedAt = now on every slide that doesn't
//                   already have one. Existing locks keep their
//                   original lockedAt (idempotent — repeat call
//                   doesn't bump the timestamp). Slides without a
//                   SlideState row get one created.
//   locked=false  → clear lockedAt on every existing row. Slides
//                   without a row stay row-less (they were already
//                   "unlocked" by default).
//
// cachedComments is NOT modified by this route — it's a per-slide
// in-flight authoring concern, not something a bulk freeze should
// trample. The single-slide lock route does wipe cachedComments on
// lock because the user has explicit per-slide intent there; the
// bulk path is a coarser action and respects that distinction.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { SlideManifestSchema } from "@/lib/schema/slide";

const BodySchema = z.object({
  locked: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Strict body validation — matches the contract enforced by
  // /lock, /regen, /favorite.
  const rawText = await request.text();
  if (rawText.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body required" },
      { status: 400 },
    );
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  const bodyResult = BodySchema.safeParse(parsedBody);
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: "locked must be a boolean" },
      { status: 400 },
    );
  }
  const shouldLock = bodyResult.data.locked;

  // Resolve ownership + grab the current manifest so we know which
  // slide keys exist. The slide list lives in the active version's
  // slideJson — there's no separate "slides" table.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      presentation: {
        select: {
          id: true,
          currentVersionId: true,
          versions: {
            select: { id: true, slideJson: true },
          },
        },
      },
    },
  });
  if (
    !project ||
    !project.presentation ||
    !project.presentation.currentVersionId
  ) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const presentationId = project.presentation.id;
  const currentVersion = project.presentation.versions.find(
    (v) => v.id === project.presentation!.currentVersionId,
  );
  if (!currentVersion) {
    return NextResponse.json(
      { error: "Current version missing — generation incomplete" },
      { status: 409 },
    );
  }

  // Manifest may not have been Zod-validated since it was last
  // written — `slideJson` is `unknown` from Prisma's POV. Parse
  // defensively; on failure we still need the slide list so we
  // can't simply 500, but we also won't trust a malformed shape.
  const manifestParse = SlideManifestSchema.safeParse(currentVersion.slideJson);
  if (!manifestParse.success) {
    return NextResponse.json(
      { error: "Slide manifest is malformed" },
      { status: 500 },
    );
  }
  const slideKeys = manifestParse.data.slides
    .map((s) => s.slideId)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (slideKeys.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Unlock path is cheap: updateMany clears lockedAt on every row
  // for this presentation. Rows that don't exist stay absent
  // (they were never locked).
  if (!shouldLock) {
    const result = await prisma.slideState.updateMany({
      where: { presentationId },
      data: { lockedAt: null },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  // Lock path: idempotent + race-safe.
  // Was: read-then-create — two concurrent calls would both see the
  // same "missing keys" set and both try to `create` them, blowing
  // up on the unique constraint. Now collapsed to two bulk ops in
  // a transaction:
  //   1. updateMany   — flip every unlocked row's lockedAt to "now"
  //                     (rows that are already locked stay
  //                     unchanged because the WHERE filters on
  //                     lockedAt: null, preserving idempotency)
  //   2. createMany   — insert rows for slide keys that don't exist
  //                     yet, with skipDuplicates: true so a
  //                     concurrent call that already inserted the
  //                     same row doesn't throw
  // Both run inside $transaction so a partial failure rolls back.
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.slideState.updateMany({
      where: {
        presentationId,
        slideKey: { in: slideKeys },
        lockedAt: null,
      },
      data: { lockedAt: now },
    });
    await tx.slideState.createMany({
      data: slideKeys.map((slideKey) => ({
        presentationId,
        slideKey,
        currentVersionNumber: 1,
        lockedAt: now,
      })),
      skipDuplicates: true,
    });
  });

  return NextResponse.json({ ok: true, count: slideKeys.length });
}
