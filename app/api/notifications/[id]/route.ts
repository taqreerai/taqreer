// DELETE /api/notifications/[id]
//
// Permanently removes ONE of the caller's own notifications so a
// client-side dismissal (bell row "X" or the All-Notifications modal)
// survives a re-hydrate instead of re-appearing on next load. Scoped to
// the authenticated recipient — you can only delete your own rows.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Scoped + idempotent: `deleteMany` filtered on the recipient is the
  // ownership guard (a row that isn't theirs — or is already gone —
  // simply deletes 0 rows, no 404 throw).
  const { count } = await prisma.notification.deleteMany({
    where: { id, recipientUserId: ctx.userId },
  });

  return NextResponse.json({ ok: true, deleted: count });
}
