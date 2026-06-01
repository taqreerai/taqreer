// PATCH  /api/brand-kits/[id]  — rename a brand kit ({ name }).
// DELETE /api/brand-kits/[id]  — permanently delete a brand kit.
//
// Both are owner-gated via `updateMany`/`deleteMany` with the owner-id
// filter so a kit owned by another user reports as missing (count ===
// 0) instead of mutating — leak-free + idempotent. DELETE relies on
// `Project.brandKitId` FK `onDelete: SetNull` (migration
// 20260527153247) so existing projects keep their brand fields in
// `aiPrompt`; only the FK pointer becomes null.
//
// 404 on missing or not-owned kit (same response either way; no
// existence leak). 401 if no auth, 404 if user-sync race.

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

  // Trim + cap at 120 chars to match the POST route's name handling.
  // Reject an empty name (the POST route falls back to a date-stamped
  // default, but a rename to "" is a user error, not an intent).
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name =
    body && typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json(
      { error: "Expected a non-empty { name } in body" },
      { status: 400 },
    );
  }

  const result = await prisma.brandKit.updateMany({
    where: { id, userId: ctx.userId },
    data: { name },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Brand kit not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}

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
