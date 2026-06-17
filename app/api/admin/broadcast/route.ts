// POST /api/admin/broadcast - admin sends a bilingual platform-wide announcement.
//
// Admin-only (requireAdminApi). The admin authors the title + message in BOTH
// English and Arabic; the notification payload carries both, and each user's
// bell renders the version matching their UI locale (resolved in the GET route).
// Fans out to EVERY user (actor null so no one is self-echo excluded), then
// records an AdminBroadcast row for history. Both are pruned after 30 days by
// the notifications-cleanup cron.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { fanOutNotification } from "@/lib/notifications/server";

const MAX_TITLE = 120;
const MAX_MESSAGE = 1000;

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const tooLong = (title: string, message: string) =>
  title.length > MAX_TITLE || message.length > MAX_MESSAGE;

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    en?: { title?: unknown; message?: unknown };
    ar?: { title?: unknown; message?: unknown };
  } | null;

  const titleEn = clean(body?.en?.title);
  const messageEn = clean(body?.en?.message);
  const titleAr = clean(body?.ar?.title);
  const messageAr = clean(body?.ar?.message);

  if (
    !titleEn ||
    !messageEn ||
    !titleAr ||
    !messageAr ||
    tooLong(titleEn, messageEn) ||
    tooLong(titleAr, messageAr)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    // Every user (admins included, per the chosen policy).
    const users = await prisma.user.findMany({ select: { id: true } });
    const recipientUserIds = users.map((u) => u.id);

    await fanOutNotification({
      type: "admin.broadcast",
      projectId: null,
      actorPrismaUserId: null,
      payload: {
        en: { title: titleEn, message: messageEn },
        ar: { title: titleAr, message: messageAr },
      },
      recipientUserIds,
    });

    const broadcast = await prisma.adminBroadcast.create({
      data: {
        titleEn,
        messageEn,
        titleAr,
        messageAr,
        recipientCount: recipientUserIds.length,
      },
      select: {
        id: true,
        titleEn: true,
        messageEn: true,
        titleAr: true,
        messageAr: true,
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
