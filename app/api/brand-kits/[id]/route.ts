// DELETE /api/brand-kits/[id]
//
// Permanently delete a brand kit owned by the caller. The
// `Project.brandKitId` FK is configured `onDelete: SetNull` on the
// `BrandKit ← Project` relation (see prisma/schema.prisma migration
// 20260527153247) so existing projects keep their brand fields in
// `aiPrompt` — only the FK pointer becomes null.
//
// 404 on missing or not-owned kit (same response either way; no
// existence leak). 401 if no auth, 404 if user-sync race.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // `deleteMany` with the owner-id filter so a kit owned by another
  // user reports as missing (count === 0) instead of throwing.
  // Idempotent on the second click + leak-free.
  const result = await prisma.brandKit.deleteMany({
    where: { id, userId: ctx.userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Brand kit not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
