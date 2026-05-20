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
import { createClient } from "@/lib/supabase/server";
import { SlideManifestSchema } from "@/lib/schema/slide";

const BodySchema = z.object({
  locked: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

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
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user: { supabaseUserId: user.id },
    },
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

  // Lock path: idempotent per-row. Existing locked rows keep their
  // original lockedAt; unlocked rows get bumped to "now"; missing
  // rows get created. Done in a transaction so a partial failure
  // doesn't leave half the deck locked. Read-then-act on the row
  // set we already have (slideKeys) — avoids a streaming upsert
  // with a per-slide round-trip.
  const existing = await prisma.slideState.findMany({
    where: { presentationId, slideKey: { in: slideKeys } },
    select: { id: true, slideKey: true, lockedAt: true },
  });
  const existingByKey = new Map(existing.map((s) => [s.slideKey, s]));
  const now = new Date();
  await prisma.$transaction([
    // Update existing unlocked rows.
    ...existing
      .filter((s) => s.lockedAt == null)
      .map((s) =>
        prisma.slideState.update({
          where: { id: s.id },
          data: { lockedAt: now },
        }),
      ),
    // Create rows for slides that have never been touched.
    ...slideKeys
      .filter((k) => !existingByKey.has(k))
      .map((slideKey) =>
        prisma.slideState.create({
          data: {
            presentationId,
            slideKey,
            currentVersionNumber: 1,
            lockedAt: now,
          },
        }),
      ),
  ]);

  return NextResponse.json({ ok: true, count: slideKeys.length });
}
