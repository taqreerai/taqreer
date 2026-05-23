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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";

type LockPayload = {
  locked?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Phase 15.A — edit access required.
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

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

  // Grab presentation id (access already verified).
  const project = await prisma.project.findUnique({
    where: { id: projectId },
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
  //   AND clear cachedComments (locking finalises the slide; the
  //   user's "in-flight" comment intent shouldn't survive a lock).
  // - locked:true on an ALREADY-locked slide → keep the original
  //   lockedAt (read-then-write below preserves it). The contract
  //   is "lock the slide", not "refresh the lock timestamp" —
  //   repeated requests leave the existing pinned-at moment alone.
  //   cachedComments was already null from the first lock; the
  //   write keeps it null.
  // - locked:false → clear lockedAt regardless of prior state.
  //   Doesn't restore cachedComments — that was wiped on lock and
  //   isn't reconstructible.
  //
  // Read-then-upsert (instead of a single upsert) because the update
  // branch of upsert can't reference the row's current lockedAt — we
  // need that to preserve the original timestamp on idempotent re-lock.
  // Previously the update branch only wrote { cachedComments: DbNull }
  // for shouldLock=true, which meant locking an EXISTING (pre-migration)
  // SlideState row never actually flipped lockedAt — the API returned
  // null and the optimistic UI flip reverted instantly.
  const existing = await prisma.slideState.findUnique({
    where: { presentationId_slideKey: { presentationId, slideKey } },
    select: { lockedAt: true },
  });
  const nextLockedAt = shouldLock
    ? (existing?.lockedAt ?? new Date())
    : null;
  const state = await prisma.slideState.upsert({
    where: {
      presentationId_slideKey: { presentationId, slideKey },
    },
    create: {
      presentationId,
      slideKey,
      currentVersionNumber: 1,
      lockedAt: nextLockedAt,
    },
    update: shouldLock
      ? { lockedAt: nextLockedAt, cachedComments: Prisma.DbNull }
      : { lockedAt: null },
    select: { lockedAt: true },
  });

  return NextResponse.json({
    ok: true,
    lockedAt: state.lockedAt ? state.lockedAt.toISOString() : null,
  });
}
