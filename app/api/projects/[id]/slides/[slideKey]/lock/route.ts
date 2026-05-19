// POST /api/projects/[id]/slides/[slideKey]/lock
//
// Sets or clears the lock on a single slide. Locked slides are
// skipped by full-deck regen (per the product spec — lock protects
// against accidental "bulk redo" loss). Direct slide-level actions
// (Regen, Undo, Try again) remain blocked client-side by the pill
// when locked; the server treats lock as advisory for those.
//
// Body: { locked: boolean }
// Returns: { ok: true, lockedAt: ISO string | null }
//
// Idempotent — calling with `locked: true` on an already-locked
// slide returns the existing lockedAt unchanged. Lazy-creates the
// SlideState row for slides that pre-date the versioning migration
// (the slide existed in PresentationVersion.slideJson but never
// got a SlideState).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type LockPayload = {
  locked?: boolean;
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
  const body = (await request.json().catch(() => ({}))) as LockPayload;
  const shouldLock = body.locked === true;

  // Verify ownership AND grab presentation id in one round-trip.
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user: { supabaseUserId: user.id },
    },
    include: {
      presentation: { select: { id: true } },
    },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const presentationId = project.presentation.id;
  const lockedAt = shouldLock ? new Date() : null;

  // Upsert keyed on (presentationId, slideKey). For legacy projects
  // that never got a SlideState seeded (pre-versioning migration),
  // this lazy-creates the row with currentVersionNumber=1.
  const state = await prisma.slideState.upsert({
    where: {
      presentationId_slideKey: { presentationId, slideKey },
    },
    create: {
      presentationId,
      slideKey,
      currentVersionNumber: 1,
      lockedAt,
    },
    update: {
      lockedAt,
    },
    select: { lockedAt: true },
  });

  return NextResponse.json({
    ok: true,
    lockedAt: state.lockedAt ? state.lockedAt.toISOString() : null,
  });
}
