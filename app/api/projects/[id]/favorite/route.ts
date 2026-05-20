// PATCH /api/projects/[id]/favorite
//
// Toggles or sets `Project.isFavorite`. Used by the ProjectActionsMenu
// "Add to favorites" / "Remove from favorites" menu item on dashboard
// tiles + (eventually) /projects tiles.
//
// Body: { isFavorite: boolean }
// Returns: { ok: true, isFavorite: boolean }
//
// Strict body validation — empty body / non-boolean returns 400 instead
// of silently coercing (same contract as /lock and /regen).
// Owner-only — relies on the same User -> Project ownership check every
// other per-project route uses.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type FavoritePayload = {
  isFavorite?: boolean;
};

export async function PATCH(
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

  // Strict body parsing — see lock route for the rationale (silent
  // {} coercion on bad input previously let corrupt requests flip
  // owner-scoped state without the user intending to).
  const rawText = await request.text();
  if (rawText.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body required" },
      { status: 400 },
    );
  }
  let body: FavoritePayload | null = null;
  try {
    body = JSON.parse(rawText) as FavoritePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || typeof body.isFavorite !== "boolean") {
    return NextResponse.json(
      { error: "isFavorite must be a boolean" },
      { status: 400 },
    );
  }
  const nextValue = body.isFavorite;

  // Ownership check + update in a single round-trip. `updateMany`
  // (vs. `update`) returns count=0 instead of throwing when the
  // composite WHERE matches no rows, which is what we want for
  // "wrong owner OR missing project" — both 404 from the user's
  // perspective.
  const result = await prisma.project.updateMany({
    where: {
      id: projectId,
      user: { supabaseUserId: user.id },
    },
    data: { isFavorite: nextValue },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, isFavorite: nextValue });
}
