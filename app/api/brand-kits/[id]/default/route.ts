// PATCH /api/brand-kits/[id]/default
//
// Set or clear the user's default brand kit. At most one kit per
// user can be the default — happy path: transactionally clear other
// `isDefault=true` rows, then flip this one. Concurrency: enforced
// by a partial unique index `BrandKit_userId_default_unique`
// (migration 20260528000127_brandkit_isdefault_partial_unique). If
// two requests race past the in-app clear step, Postgres rejects
// the second flip with a unique-constraint violation (Prisma
// P2002), which we translate into 409 — the client should retry
// after refetching the list to see which kit actually won.
//
// Body: { isDefault: boolean }
//
// Returns: { ok: true, isDefault }
//
// Authorization: owner-gated (same `findFirst({id, userId})` shape
// the DELETE + /use routes use); 404 on a mismatch so kit existence
// stays private.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    // Happy path: clear sibling defaults, then flip this one. The
    // partial unique index `BrandKit_userId_default_unique` is the
    // belt-and-suspenders guarantee against concurrent set-default
    // races; if two requests interleave past the updateMany, the
    // second `update` will hit P2002 and we surface 409 to the
    // client.
    try {
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
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return NextResponse.json(
          {
            error:
              "Another default brand kit was selected at the same time. Please refresh and try again.",
          },
          { status: 409 },
        );
      }
      throw err;
    }
  } else {
    await prisma.brandKit.update({
      where: { id },
      data: { isDefault: false },
    });
  }

  return NextResponse.json({ ok: true, isDefault: nextIsDefault });
}
