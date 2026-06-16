// POST /api/admin/templates/reorder - admin sets the featured order.
//
// Admin-only (requireAdminApi). Body: { orderedIds: string[] } - the featured
// templates in their new top-to-bottom order. Sets featuredOrder = index for
// each, in one transaction. The per-row updateMany is constrained to the
// curator's templates, so a stray/forged id can never feature a non-curator
// template (curator-only policy). Busts the cached template surfaces.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import {
  MARQUEE_OWNER_EMAIL,
  revalidateTemplateSurfaces,
} from "@/lib/auth/marquee-projects";

const MAX_FEATURED = 500;

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    orderedIds?: unknown;
  } | null;
  const ids = body?.orderedIds;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_FEATURED ||
    ids.some((x) => typeof x !== "string")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const orderedIds = ids as string[];

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.template.updateMany({
        where: { id, owner: { email: MARQUEE_OWNER_EMAIL } },
        data: { featuredOrder: index },
      }),
    ),
  );
  revalidateTemplateSurfaces();
  return NextResponse.json({ ok: true });
}
