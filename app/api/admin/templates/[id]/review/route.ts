// POST /api/admin/templates/[id]/review - admin approve/deny of a user's
// request to publish a template to the community.
//
// Admin-only (requireAdminApi). Body: { decision: "approve" | "reject" }.
//   - approve: the template goes LIVE. isPublic=true, reviewStatus=APPROVED,
//     publishedAt=now (the community-feed ordering key is stamped at approval,
//     not at request time). The in-app community surfaces are revalidated.
//   - reject:  reverts to PRIVATE (isPublic stays false). The owner keeps a
//     normal private template and can resubmit later. Nothing was ever public,
//     so no surface purge is needed.
//
// Only a PENDING template can be reviewed. The transition is written with an
// updateMany scoped to reviewStatus=PENDING so two admins acting at once (or a
// stale queue) can't double-apply - count=0 => 409 not_pending.
//
// This route is intentionally NOT curator-scoped (unlike the featured/seo
// curation in ../route.ts): the approval queue moderates EVERY user's request.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { revalidateTemplateSurfaces } from "@/lib/auth/marquee-projects";

type ReviewBody = { decision?: unknown };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;

  const body = (await request.json().catch(() => null)) as ReviewBody | null;
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }

  const data =
    decision === "approve"
      ? {
          isPublic: true,
          reviewStatus: "APPROVED" as const,
          // Stamp the feed-ordering key now: a freshly approved template
          // should surface at the head of the community feed, not buried by
          // its (possibly weeks-old) createdAt.
          publishedAt: new Date(),
        }
      : { reviewStatus: "PRIVATE" as const };

  // Atomic on (id, PENDING): only an outstanding request transitions.
  const result = await prisma.template.updateMany({
    where: { id, reviewStatus: "PENDING" },
    data,
  });
  if (result.count === 0) {
    // Either the id is unknown or it isn't awaiting review (already
    // approved/withdrawn, or another admin just handled it).
    return NextResponse.json({ error: "not_pending" }, { status: 409 });
  }

  // An approval makes the template visible in the in-app community feed +
  // dashboard widget, so bust the cached template surfaces. A rejection never
  // changed public state, so skip the purge.
  if (decision === "approve") {
    await revalidateTemplateSurfaces();
  }

  return NextResponse.json({ ok: true, decision });
}
