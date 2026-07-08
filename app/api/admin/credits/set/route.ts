// POST /api/admin/credits/set - admin sets one user's SUBSCRIPTION balance to
// an absolute value (the clawback tool for farmed signup grants - amount 0
// empties it). Top-up grants are untouched.
//
// Admin-only (requireAdminApi). Audited via UsageEvent "credit.admin.set"
// (amount = delta; before/after + adminUserId + optional reason in metadata).
// Returns the fresh BalanceSnapshot so the admin UI can show the new TOTAL
// (which still includes any top-ups) without guessing.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { setSubscriptionBalance } from "@/lib/credits/server";

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    amount?: number;
    reason?: string;
  } | null;

  const userId = body?.userId;
  const amount = body?.amount;
  const reason =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : undefined;
  if (!userId || !Number.isInteger(amount) || (amount as number) < 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const balance = await setSubscriptionBalance({
    userId,
    target: amount as number,
    adminUserId: ctx.userId,
    reason,
    notify: true,
  });

  return NextResponse.json({ ok: true, balance });
}
