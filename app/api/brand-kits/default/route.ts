// GET /api/brand-kits/default
//
// Return the current user's default brand kit (if any), in the SAME
// shape `POST /api/brand-kits/[id]/use` returns — including a freshly-
// signed logo URL. The four landing flows call this on first mount
// (when no sessionStorage brand exists) to auto-hydrate from the
// default kit. Returns `{ kit: null }` when no default is set.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";
import { buildLogoResponse, extractLogoBlob } from "../_helpers";

export async function GET() {
  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const kit = await prisma.brandKit.findFirst({
    where: { userId: ctx.userId, isDefault: true },
    select: {
      id: true,
      name: true,
      colors: true,
      fonts: true,
      assetUrls: true,
    },
  });
  if (!kit) {
    return NextResponse.json({ kit: null });
  }

  const logo = await buildLogoResponse(
    extractLogoBlob(kit.assetUrls),
    ctx.supabaseUserId,
  );

  return NextResponse.json({
    kit: {
      id: kit.id,
      name: kit.name,
      colors: kit.colors ?? null,
      fonts: kit.fonts ?? null,
      logo,
    },
  });
}
