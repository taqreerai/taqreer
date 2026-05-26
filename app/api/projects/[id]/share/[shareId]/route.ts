// DELETE /api/projects/[id]/share/[shareId] — Owner revokes an invitee.
//
// Removes the ProjectShare row entirely. Why a hard delete (not a
// "soft delete + null token"):
//   • Re-inviting the same email later should be clean: a fresh row,
//     fresh token, fresh invitedAt. Keeping the historical row would
//     muddle the unique-(projectId, email) constraint and force the
//     route to either upsert-into-soft-deleted or carry "tombstone"
//     state into the share modal.
//   • There's no analytics value in keeping revoked-share history;
//     the audit trail belongs in a separate ledger if we ever want
//     one.
//
// Owner-only — `resolveProjectContext` returns 404 for non-owners
// (no existence leak).
//
// The route also guards against the cross-project delete attack:
// `deleteMany` filters on BOTH `id` AND `projectId`, so even if a
// non-owner discovered a real shareId they can't delete it via a
// different project they DO own.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectContext } from "@/lib/api/project-context";
import { broadcastToUser } from "@/lib/realtime/server-broadcast";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id: projectId, shareId } = await params;
  const ctx = await resolveProjectContext(projectId);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Look up the share row BEFORE deleting so we can address the
  // realtime broadcast to the right recipient. `userId` is the
  // Prisma id of the user who accepted the invite (null for
  // pending email-only invites that were never accepted — those
  // have no browser session to kick out, so the broadcast is
  // safely skipped for them).
  const share = await prisma.projectShare.findFirst({
    where: { id: shareId, projectId },
    select: { userId: true },
  });
  if (!share) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  // `deleteMany` instead of `delete` — a missing row should return
  // 404 rather than throw P2025. Owner-scoped via the (id, projectId)
  // composite filter; non-owner already filtered upstream by
  // resolveProjectContext, but the projectId guard here is the
  // belt-and-suspenders against an owner trying to delete a share
  // row that belongs to a different project they ALSO own.
  const result = await prisma.projectShare.deleteMany({
    where: { id: shareId, projectId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  // Fire-and-forget broadcast: if the revoked share belongs to an
  // ACCEPTED user (has a Prisma userId), push `share.revoked` to
  // their user channel. The client listener redirects them to
  // /dashboard when they're currently viewing the project. No await
  // — same fire-and-forget pattern as the rest of the broadcast
  // call sites; a failed socket write shouldn't fail the revoke.
  if (share.userId) {
    void broadcastToUser(share.userId, "share.revoked", {
      projectId,
    }).catch((err) => {
      console.warn("[share-revoke] broadcastToUser failed", {
        recipientId: share.userId,
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return NextResponse.json({ ok: true });
}
