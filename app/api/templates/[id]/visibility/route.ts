// PATCH /api/templates/[id]/visibility
//
// Owner-driven publish lifecycle for a template (admins bypass the owner
// scope — see isAdminSupabaseUser below — so they can pull an abusive public
// template private).
//
// Body: { isPublic: boolean }
//   • isPublic: true  — REQUEST to publish. Publishing is NOT self-service:
//     this only moves a PRIVATE template into PENDING (the admin review
//     queue). An admin approves it via /api/admin/templates/[id]/review,
//     which is the sole path that sets isPublic=true. Idempotent when the
//     template is already PENDING or APPROVED.
//   • isPublic: false — make private / withdraw. Clears isPublic, resets
//     reviewStatus to PRIVATE, and clears publishedAt + featuredOrder.
//
// Invariant preserved: isPublic === true  <=>  reviewStatus === APPROVED.
// `publishedAt` (the community feed's `ORDER BY publishedAt DESC` key) is only
// stamped at approval time; withdrawing clears it.
//
// Response:
//   200 { ok: true, isPublic, reviewStatus, publishedAt }
//   400 invalid body
//   401 unauthorised
//   404 template not found / not owned

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isAdminSupabaseUser } from "@/lib/api/admin-context";
import {
  revalidateTemplateSurfaces,
  templateDetailPaths,
} from "@/lib/auth/marquee-projects";

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
  const wantPublic = body.isPublic;

  // Admins bypass the owner scope so they can withdraw any public template
  // (feature: full admin ownership). A non-admin keeps the owner-only scope.
  const admin = await isAdminSupabaseUser(user.id);
  const scope = admin
    ? { id: templateId }
    : { id: templateId, owner: { supabaseUserId: user.id } };

  const current = await prisma.template.findFirst({
    where: scope,
    select: { isPublic: true, reviewStatus: true, slug: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Compute the next state. Publishing is not self-service: a request to go
  // public only enters the PENDING queue; an admin approval is the sole writer
  // of isPublic=true. Withdrawing resets everything to PRIVATE.
  let data: {
    isPublic?: boolean;
    reviewStatus?: "PRIVATE" | "PENDING" | "APPROVED";
    publishedAt?: Date | null;
    featuredOrder?: number | null;
  };
  if (wantPublic) {
    // Already public (approved) or already awaiting review → no-op, so a
    // double-tap can't churn state or re-queue an approved template.
    if (current.reviewStatus === "APPROVED" || current.reviewStatus === "PENDING") {
      data = {};
    } else {
      // PRIVATE → PENDING. isPublic stays false; nothing goes live yet.
      data = { reviewStatus: "PENDING" };
    }
  } else {
    // Make private / withdraw. Featured templates must stay public, so
    // un-publishing also clears the featured slot.
    data = {
      isPublic: false,
      reviewStatus: "PRIVATE",
      publishedAt: null,
      featuredOrder: null,
    };
  }

  // `updateMany` (not update-by-id) keeps the write atomic on the resolved
  // scope: count=0 means the row vanished or (for a non-admin) isn't owned →
  // 404, no existence leak.
  const result = await prisma.template.updateMany({
    where: scope,
    data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const updated = await prisma.template.findUnique({
    where: { id: templateId },
    select: { isPublic: true, reviewStatus: true, publishedAt: true },
  });

  // Only a withdrawal of an ALREADY-public template changes the community
  // surfaces (a PRIVATE→PENDING request is invisible to the public). Bust the
  // Next + Cloudflare caches only in that case.
  const wentPrivate = !wantPublic && current.isPublic;
  if (wentPrivate) {
    // Unpublishing drops the slug from the fresh-slug purge query, so the
    // detail URLs must be passed explicitly to evict the edge copy.
    await revalidateTemplateSurfaces(
      current.slug ? templateDetailPaths(current.slug) : [],
    );
  }

  return NextResponse.json({
    ok: true,
    isPublic: updated?.isPublic ?? false,
    reviewStatus: updated?.reviewStatus ?? current.reviewStatus,
    publishedAt: updated?.publishedAt ?? null,
  });
}
