// POST /api/projects/[id]/unlock
//
// Teaser paywall (free-tier conversion). A free `create` deck is authored as a
// longer deck of which only the first N slides render; the withheld tail shows
// blurred + locked in the viewer. This endpoint fires the COMPED generation of
// those withheld slides on Opus once the owner is on a paid plan.
//
// Body: empty. The withheld count + source live on the deck. Guards:
//   - caller must be the OWNER (admin bypass counts as owner) - not a shared
//     collaborator (this is a billing-adjacent action on the owner's deck).
//   - the deck must still be a locked teaser (teaserLockedCount > 0) and not
//     already unlocked (teaserUnlockedAt == null) - idempotent.
//   - the OWNER must be on a paid plan (or admin). A free owner gets a 402 so
//     the studio opens the UpgradeModal; the unlock fires on subscribe success.
// The unlock is COMPED (no credit hold/settle) - it is the conversion reward.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { isPaidPlan } from "@/lib/plan";
import { dispatchTeaserUnlock } from "@/lib/billing/deck-unlock";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Require edit access, then narrow to OWNER (admin bypass resolves to
  // "owner"). A shared editor/commenter cannot unlock someone else's deck.
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can unlock" }, { status: 403 });
  }
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      purchasedAt: true,
      user: { select: { plan: true, role: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  // Entitlement: a paid owner, an admin (comped), or a one-time purchase of
  // THIS deck. A free owner who hasn't bought it gets a 402 so the studio
  // opens the unlock window.
  const entitled =
    isPaidPlan(project.user.plan) ||
    project.user.role === "admin" ||
    project.purchasedAt != null;
  if (!entitled) {
    return NextResponse.json({ error: "upgrade_required" }, { status: 402 });
  }
  const result = await dispatchTeaserUnlock(id, access.user.prismaId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
