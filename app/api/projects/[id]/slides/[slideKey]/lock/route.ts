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
  const body = (await request.json().catch(() => null)) as LockPayload | null;
  // Malformed / missing payload returns 400 instead of falling
  // through. Previously `({})` default + `body.locked === true`
  // silently coerced bad input into an UNLOCK — a corrupt request
  // could clear an existing lock the user didn't intend to touch.
  if (!body || typeof body.locked !== "boolean") {
    return NextResponse.json(
      { error: "locked must be a boolean" },
      { status: 400 },
    );
  }
  const shouldLock = body.locked;

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

  // Idempotent semantics:
  // - locked:true on an unlocked slide  → set lockedAt = now
  // - locked:true on an ALREADY-locked slide → keep the original
  //   lockedAt (no-op on the update branch). The contract is "lock
  //   the slide", not "refresh the lock timestamp" — repeated
  //   requests should leave the existing pinned-at moment alone.
  // - locked:false → clear lockedAt regardless of prior state.
  const state = await prisma.slideState.upsert({
    where: {
      presentationId_slideKey: { presentationId, slideKey },
    },
    create: {
      presentationId,
      slideKey,
      currentVersionNumber: 1,
      lockedAt: shouldLock ? new Date() : null,
    },
    update: shouldLock ? {} : { lockedAt: null },
    select: { lockedAt: true },
  });

  return NextResponse.json({
    ok: true,
    lockedAt: state.lockedAt ? state.lockedAt.toISOString() : null,
  });
}
