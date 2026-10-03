// POST /api/projects/[id]/font
//
// Body: { family: string }  (a Google Fonts catalog family)
//
// Changes the whole finished deck's font in place (lib/deck/refont.ts): the
// theme font plus every literal family in the slides' font-family
// declarations. No AI call, no credits, open to every plan. The family must
// be in the bundled Google Fonts catalog (canonicalFamily), so only a known
// name ever reaches the CSS. The studio previews the same function client-
// side and calls this once on Apply.
//
// Persists like a manual edit: PresentationVersion.slideJson in place, no
// SlideVersion rows (the client marks every slide dirty so Save checkpoints
// them). 409 while the deck is still generating.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { refontManifest } from "@/lib/deck/refont";
import { canonicalFamily } from "@/lib/editor/font-search";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = (await request.json().catch(() => ({}))) as { family?: unknown };
  const family =
    typeof body.family === "string" && body.family.length <= 80
      ? canonicalFamily(body.family)
      : null;
  if (!family) {
    return NextResponse.json({ error: "Unknown font family" }, { status: 400 });
  }

  const presentation = await prisma.presentation.findUnique({
    where: { projectId },
    select: { currentVersionId: true },
  });
  if (!presentation?.currentVersionId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const version = await prisma.presentationVersion.findUnique({
    where: { id: presentation.currentVersionId },
    select: { id: true, status: true, slideJson: true },
  });
  if (!version) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (version.status !== "completed") {
    return NextResponse.json({ error: "Deck is still generating" }, { status: 409 });
  }
  const parsed = SlideManifestSchema.safeParse(version.slideJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Deck data is invalid" }, { status: 500 });
  }
  const next = SlideManifestSchema.safeParse(refontManifest(parsed.data, family));
  if (!next.success) {
    console.error("[font] result failed validation", next.error.issues.slice(0, 3));
    return NextResponse.json({ error: "Failed to change the font" }, { status: 500 });
  }

  // Merge over the stored JSON so manifest keys the schema doesn't model
  // (status, genChat extras) survive the write.
  const stored = version.slideJson as Record<string, unknown>;
  await prisma.presentationVersion.update({
    where: { id: version.id },
    data: {
      slideJson: { ...stored, theme: next.data.theme, slides: next.data.slides } as never,
    },
  });

  return NextResponse.json({ theme: next.data.theme, slides: next.data.slides });
}
