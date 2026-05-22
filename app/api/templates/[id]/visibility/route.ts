// PATCH /api/templates/[id]/visibility
//
// Toggle a template between خاصة (private) and المجتمع (public).
// Owner-only.
//
// Body: { isPublic: boolean }
//
// Side effect on the DB row: `publishedAt` is set to `now()` when
// `isPublic` flips true, and cleared (null) when it flips false. The
// community feed orders by `publishedAt DESC` — using it as the
// canonical "when this became visible" timestamp keeps a template
// that was private for weeks and just published from getting buried
// under older publish events that happened to share its createdAt.
//
// Response:
//   200 { ok: true, isPublic, publishedAt }
//   400 invalid body
//   401 unauthorised
//   404 template not found / not owned

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type VisibilityBody = { isPublic?: unknown };

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

  const { id: templateId } = await params;

  let body: VisibilityBody;
  try {
    body = (await request.json()) as VisibilityBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.isPublic !== "boolean") {
    return NextResponse.json(
      { error: "isPublic must be a boolean" },
      { status: 400 },
    );
  }
  const nextPublic = body.isPublic;

  // Owner-scoped update — `updateMany` instead of `update({ where:
  // { id } })` makes the write atomic on (id, owner). count=0 if the
  // template doesn't exist OR isn't owned by the user → 404, no
  // existence leak.
  const result = await prisma.template.updateMany({
    where: {
      id: templateId,
      owner: { supabaseUserId: user.id },
    },
    data: {
      isPublic: nextPublic,
      publishedAt: nextPublic ? new Date() : null,
    },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Read back the canonical publishedAt the DB committed so the
  // client can update its local row without guessing the timestamp.
  const updated = await prisma.template.findUnique({
    where: { id: templateId },
    select: { isPublic: true, publishedAt: true },
  });
  return NextResponse.json({
    ok: true,
    isPublic: updated?.isPublic ?? nextPublic,
    publishedAt: updated?.publishedAt ?? null,
  });
}
