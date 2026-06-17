// POST /api/admin/broadcast - admin sends a platform-wide announcement.
//
// Admin-only (requireAdminApi). Fans a single (one-language) title + message out
// to EVERY user's bell via fanOutNotification (recipientUserIds = all users,
// projectId null, actor null so no one is self-echo excluded), then records an
// AdminBroadcast row for the history list + recipient count. Both the bell rows
// and this row are pruned after 30 days by the notifications-cleanup cron.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { fanOutNotification } from "@/lib/notifications/server";

const MAX_TITLE = 120;
const MAX_MESSAGE = 1000;

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    message?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (
    !title ||
    !message ||
    title.length > MAX_TITLE ||
    message.length > MAX_MESSAGE
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    // Every user (admins included, per the chosen policy).
    const users = await prisma.user.findMany({ select: { id: true } });
    const recipientUserIds = users.map((u) => u.id);

    // System event (actor null) so the whole recipient set receives it; the
    // fan-out also emits on each user channel so live bells update.
    await fanOutNotification({
      type: "admin.broadcast",
      projectId: null,
      actorPrismaUserId: null,
      payload: { title, message },
      recipientUserIds,
    });

    const broadcast = await prisma.adminBroadcast.create({
      data: { title, message, recipientCount: recipientUserIds.length },
      select: {
        id: true,
        title: true,
        message: true,
        recipientCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, broadcast });
  } catch (err) {
    console.error("[admin/broadcast] send failed", err);
    return NextResponse.json({ error: "broadcast_failed" }, { status: 500 });
  }
}
