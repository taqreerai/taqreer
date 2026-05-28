// PATCH /api/brand-kits/[id]/default
//
// Set or clear the user's default brand kit. At most one kit per
// user can be the default — when setting one to true we transaction-
// ally clear every other kit's `isDefault` flag first, then flip
// this one. The migration adds a `(userId, isDefault)` index so
// the bulk update is cheap.
//
// Body: { isDefault: boolean }
//
// Returns: { ok: true, isDefault }
//
// Authorization: owner-gated (same `findFirst({id, userId})` shape
// the DELETE + /use routes use); 404 on a mismatch so kit existence
// stays private.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = (await request.json().catch(() => null)) as {
    isDefault?: unknown;
  } | null;
  if (!body || typeof body.isDefault !== "boolean") {
    return NextResponse.json(
      { error: "Expected { isDefault: boolean } in body" },
      { status: 400 },
    );
  }
  const nextIsDefault = body.isDefault;

  // Ownership pre-check — a non-owned id must NOT mutate any row.
  const kit = await prisma.brandKit.findFirst({
    where: { id, userId: ctx.userId },
    select: { id: true },
  });
  if (!kit) {
    return NextResponse.json({ error: "Brand kit not found" }, { status: 404 });
  }

  if (nextIsDefault) {
    // Transactionally clear other defaults, then flip this one. Two
    // statements so concurrent set-default calls from two tabs land
    // in a consistent state (no double-default).
    await prisma.$transaction([
      prisma.brandKit.updateMany({
        where: { userId: ctx.userId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      }),
      prisma.brandKit.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  } else {
    await prisma.brandKit.update({
      where: { id },
      data: { isDefault: false },
    });
  }

  return NextResponse.json({ ok: true, isDefault: nextIsDefault });
}
