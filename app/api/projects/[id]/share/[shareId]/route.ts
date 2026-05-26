// DELETE /api/projects/[id]/share/[shareId] — Owner revokes an invitee.
//
// SOFT delete: sets `revokedAt = now()` + nulls `inviteToken` on the
// existing ProjectShare row, instead of removing it. Why we switched
// from hard delete (2026-05-26 — user direction "revoked user still
// can access through the link"):
//   • The access resolver needs to DENY the revoked user explicitly.
//     If we hard-deleted the row, a project with `publicAccessLevel
//     = "view"` would let the kicked user fall through to the
//     public-link view — they could keep using the URL even after
//     being removed.
//   • Keeping the row + checking `revokedAt` in
//     `resolveProjectAccess` makes the explicit revoke outrank the
//     public-link fallback. The kicked user is now truly out.
//
// Re-invite path (share POST upsert) resets `revokedAt: null` +
// rotates the token + clears acceptedAt/userId — so re-inviting the
// same email is still clean despite the soft-delete tombstone.
//
// List queries (GET /api/projects/[id]/share, accept route lookup)
// filter `revokedAt: null` so revoked rows don't surface in the UI
// or accidentally re-grant access via a stale token.
//
// Owner-only — `resolveProjectContext` returns 404 for non-owners
// (no existence leak).
//
// The route also guards against the cross-project update attack:
// `updateMany` filters on BOTH `id` AND `projectId`, so even if a
// non-owner discovered a real shareId they can't revoke it via a
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

  // Look up the share row BEFORE revoking so we can address the
  // realtime broadcast to the right recipient. `userId` is the
  // Prisma id of the user who accepted the invite (null for
  // pending email-only invites that were never accepted — those
  // have no browser session to kick out, so the broadcast is
  // safely skipped for them). Also gate on `revokedAt: null` so
  // a double-revoke (idempotent re-call) returns the same 404
  // shape as "row doesn't exist" rather than re-bumping the
  // timestamp.
  const share = await prisma.projectShare.findFirst({
    where: { id: shareId, projectId, revokedAt: null },
    select: { userId: true },
  });
  if (!share) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  // `updateMany` instead of `update` — a missing row should return
  // 404 rather than throw P2025. Owner-scoped via the (id, projectId)
  // composite filter; non-owner already filtered upstream by
  // resolveProjectContext, but the projectId guard here is the
  // belt-and-suspenders against an owner trying to revoke a share
  // row that belongs to a different project they ALSO own.
  // Token null'd alongside revokedAt so a stale email link can't be
  // used to re-accept after revocation.
  const result = await prisma.projectShare.updateMany({
    where: { id: shareId, projectId, revokedAt: null },
    data: { revokedAt: new Date(), inviteToken: null },
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
