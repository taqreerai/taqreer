// POST /api/notifications/read-all
//
// Marks every unread notification for the current user as read. Fired
// by the bell when the user opens the dropdown — product decision is
// "all-read on bell open" rather than per-row click. The dropdown
// itself stops showing the unread-dot decoration the moment its
// onOpenChange fires; this route lands the persisted side.
//
// No body — implicit operation on the caller's notifications.
//
// Response: { ok: true, count: number } where `count` is the number
// of rows newly transitioned from unread → read. Useful for the
// optimistic client update + smoke tests (the badge should drop to
// zero after the call resolves).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: data.user.id },
    select: { id: true },
  });
  if (!dbUser) {
    // User-sync race — no Prisma row yet, no notifications exist for
    // them. Idempotent OK with count: 0.
    return NextResponse.json({ ok: true, count: 0 });
  }

  const result = await prisma.notification.updateMany({
    where: { recipientUserId: dbUser.id, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true, count: result.count });
}
