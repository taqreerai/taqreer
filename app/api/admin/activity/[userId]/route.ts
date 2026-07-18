// GET /api/admin/activity/[userId]?limit=&before=
//
// Admin-only. Returns one user's merged activity timeline (generations, full +
// partial regens, failed/cancelled runs, exports), lazily loaded by the Activity
// tab when a row expands. Cursor-paginated via `before` (an ISO timestamp) +
// `nextCursor`. All data is Prisma; getUserActivityTimeline clamps the limit.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { getUserActivityTimeline } from "@/lib/admin/activity";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { userId } = await params;
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  // Integer-only: a fractional limit would reach Prisma's `take` and throw.
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const before = url.searchParams.get("before") ?? undefined;

  const timeline = await getUserActivityTimeline(userId, { limit, before });
  return NextResponse.json(timeline);
}
