// PATCH /api/admin/templates/[id] - admin curation of one template.
//
// Admin-only (requireAdminApi). Body: { isPremium?, featured? }.
//   - isPremium: flips the Pro-plan gate (enforced at use-time, 402).
//   - featured true:  append to the END of the curator's featured order so it
//     appears on the landing marquee/grid. Curator-only + must be public.
//   - featured false: clear featuredOrder (drop it from the public surfaces).
// Any write busts the cached template surfaces.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import {
  MARQUEE_OWNER_EMAIL,
  revalidateTemplateSurfaces,
} from "@/lib/auth/marquee-projects";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    isPremium?: boolean;
    featured?: boolean;
  } | null;
  if (
    !body ||
    (typeof body.isPremium !== "boolean" && typeof body.featured !== "boolean")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tpl = await prisma.template.findUnique({
    where: { id },
    select: {
      id: true,
      isPublic: true,
      featuredOrder: true,
      owner: { select: { email: true } },
    },
  });
  if (!tpl) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  const data: { isPremium?: boolean; featuredOrder?: number | null } = {};

  if (typeof body.isPremium === "boolean") {
    data.isPremium = body.isPremium;
  }

  if (typeof body.featured === "boolean") {
    if (body.featured) {
      // Curator-only featuring; only public templates reach the landing.
      if (tpl.owner.email !== MARQUEE_OWNER_EMAIL) {
        return NextResponse.json({ error: "not_curator_template" }, { status: 400 });
      }
      if (!tpl.isPublic) {
        return NextResponse.json({ error: "not_public" }, { status: 400 });
      }
      // Append to the end (no-op if already featured).
      if (tpl.featuredOrder === null) {
        const agg = await prisma.template.aggregate({
          where: { owner: { email: MARQUEE_OWNER_EMAIL }, featuredOrder: { not: null } },
          _max: { featuredOrder: true },
        });
        data.featuredOrder = (agg._max.featuredOrder ?? -1) + 1;
      }
    } else {
      data.featuredOrder = null;
    }
  }

  await prisma.template.update({ where: { id }, data });
  revalidateTemplateSurfaces();
  return NextResponse.json({ ok: true });
}
