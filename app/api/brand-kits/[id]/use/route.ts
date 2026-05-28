// POST /api/brand-kits/[id]/use
//
// Return the brand kit's full state for `seedFromBrandKit` to write
// into sessionStorage. Mirrors `POST /api/templates/[id]/use` in
// shape: owner-gated, returns validated brand data + a freshly-
// signed logo URL.
//
// Authorization: the kit MUST be owned by the caller. Brand kits
// are private by design — no public/share semantics exist for
// them. We return 404 (not 403) on a mismatch so the existence of
// other users' kits doesn't leak.
//
// Returns:
//   { name, colors, fonts, logo: { storageUrl, signedUrl, name, position, exclude } | null }
//
// The signed URL is short-lived (1 hour) — the seed helper writes
// it to sessionStorage where it's read by the landing flow's logo
// preview. The PATH (`storageUrl`) is kept separate so the brief
// submission can re-sign it server-side via `signBrandAssetUrl`.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveUserContext } from "@/lib/api/user-context";
import { buildLogoResponse, extractLogoBlob } from "../../_helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveUserContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const kit = await prisma.brandKit.findFirst({
    where: { id, userId: ctx.userId },
    select: {
      name: true,
      colors: true,
      fonts: true,
      assetUrls: true,
    },
  });
  if (!kit) {
    return NextResponse.json({ error: "Brand kit not found" }, { status: 404 });
  }

  const logo = await buildLogoResponse(
    extractLogoBlob(kit.assetUrls),
    ctx.supabaseUserId,
  );

  return NextResponse.json({
    name: kit.name,
    colors: kit.colors ?? null,
    fonts: kit.fonts ?? null,
    logo,
  });
}
