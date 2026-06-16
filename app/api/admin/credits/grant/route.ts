// POST /api/admin/credits/grant - admin grants credits to one user or all.
//
// Admin-only (requireAdminApi). Mirrors the Stripe-webhook top-up path: each
// grant is a grantTopup with a unique sourceKey so it's idempotent on retry and
// audited (UsageEvent eventType "credit.grant.topup"). "all" loops every user
// (fine at admin scale). notify:true broadcasts the balance change to the user.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { grantTopup } from "@/lib/credits/server";

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    target?: string;
    amount?: number;
  } | null;

  const target = body?.target;
  const amount = body?.amount;
  if (!target || !Number.isInteger(amount) || (amount ?? 0) <= 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const credits = amount as number;

  // One id per grant action; the per-user suffix keeps each grantTopup unique.
  const grantId = crypto.randomUUID();

  let userIds: string[];
  if (target === "all") {
    const rows = await prisma.user.findMany({ select: { id: true } });
    userIds = rows.map((r) => r.id);
  } else {
    const u = await prisma.user.findUnique({
      where: { id: target },
      select: { id: true },
    });
    if (!u) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }
    userIds = [u.id];
  }

  let granted = 0;
  for (const userId of userIds) {
    const res = await grantTopup({
      userId,
      credits,
      sourceKey: `admin:${grantId}:${userId}`,
      notify: true,
    });
    if (res.granted > 0) granted += 1;
  }

  return NextResponse.json({ ok: true, count: granted });
}
