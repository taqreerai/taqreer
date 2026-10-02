// POST /api/projects/[id]/recolor
//
// Body: { palette: string[] }  (6-digit hex, index-aligned to the deck's
// CURRENT theme.palette; the studio builds it from a colour preset via
// presetToPalette, or sends theme.basePalette to restore the original)
//
// Re-skins the whole finished deck in place with the deterministic recolor
// (lib/deck/recolor.ts): swaps the theme palette AND maps the colour literals
// inside every slide. No AI call, no credits, so it is open to every plan.
// The studio previews the same function client-side and calls this once on
// Apply; recomputing here from the stored manifest (never trusting client
// HTML) keeps the write safe: the transform only rewrites colour tokens.
//
// Persists like a manual edit: PresentationVersion.slideJson in place, no
// SlideVersion rows (the client marks every slide dirty so Save checkpoints
// them). 409 when the deck is still generating or the palette length no longer
// matches (a stale tab).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { recolorManifest } from "@/lib/deck/recolor";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = (await request.json().catch(() => ({}))) as { palette?: unknown };
  const palette = body.palette;
  if (
    !Array.isArray(palette) ||
    palette.length < 3 ||
    palette.length > 8 ||
    !palette.every((c) => typeof c === "string" && HEX6.test(c))
  ) {
    return NextResponse.json({ error: "palette must be 3-8 hex colours" }, { status: 400 });
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
  if (parsed.data.theme.palette.length !== palette.length) {
    return NextResponse.json({ error: "Deck colours changed, reload the page" }, { status: 409 });
  }

  const next = SlideManifestSchema.safeParse(
    recolorManifest(parsed.data, palette as string[]),
  );
  if (!next.success) {
    console.error("[recolor] result failed validation", next.error.issues.slice(0, 3));
    return NextResponse.json({ error: "Failed to recolor" }, { status: 500 });
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
