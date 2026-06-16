// POST /api/admin/users/[id]/ban - admin bans or unbans a user.
//
// Admin-only (requireAdminApi). Sets User.bannedAt (+ banReason) or clears them.
// A ban is a local flag (Supabase keeps the session), so enforcement lives in
// the (app) layout (redirect to /banned) and the API auth resolvers (403).
// Idempotent: re-banning just refreshes the timestamp.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    reason?: string;
  } | null;

  const action = body?.action;
  if (action !== "ban" && action !== "unban") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // An admin can't ban themselves out of the console.
  if (action === "ban" && id === ctx.userId) {
    return NextResponse.json({ error: "cannot_ban_self" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id },
    data:
      action === "ban"
        ? { bannedAt: new Date(), banReason: body?.reason?.trim() || null }
        : { bannedAt: null, banReason: null },
  });

  return NextResponse.json({ ok: true, banned: action === "ban" });
}
