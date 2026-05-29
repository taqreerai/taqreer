// POST /api/projects/[id]/use-as-template
//
// "Use this project as a template in the Mimic flow" — the project-tile
// counterpart of POST /api/templates/[id]/use, but nothing is persisted.
// It renders the project's own deck to a PDF on the fly, uploads it to
// the Anthropic Files API to mint a fresh design-reference `file_id`,
// and returns the brand tags — exactly the shape the Mimic template
// flow consumes (designAnthropicFileId + brand + format + language).
//
// Owner-only. The PDF is ephemeral (never stored): a project carries no
// pdfUrl, and file_ids expire, so we render + mint per use.
//
// Response:
//   200 { title, brand, designAnthropicFileId, format, language }
//   401 unauthorised
//   404 project not found / not owned / no completed manifest
//   422 brand derivation failed
//   502 PDF render / Files API failure

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectContext } from "@/lib/api/project-context";
import { deriveBrandSnapshot } from "@/lib/template/derive-brand";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { renderDeckPdf } from "@/lib/export/render-deck-pdf";
import { uploadFileToAnthropic } from "@/lib/anthropic/files";
import { MAX_TEMPLATE_SLIDES } from "@/lib/template/constants";

// Node runtime — Puppeteer + the Anthropic SDK + Buffer; the render +
// upload can take several seconds.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const ctx = await resolveProjectContext(projectId);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const project = await prisma.project.findFirst({
    where: { id: ctx.project.id },
    select: {
      id: true,
      title: true,
      templateName: true,
      language: true,
      format: true,
      presentation: {
        select: {
          versions: {
            where: { status: "completed" },
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { slideJson: true },
          },
        },
      },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const rawManifest = project.presentation?.versions[0]?.slideJson;
  if (!rawManifest) {
    return NextResponse.json(
      { error: "Project has no completed manifest yet" },
      { status: 404 },
    );
  }

  const brand = deriveBrandSnapshot({ project, manifest: rawManifest });
  if (!brand) {
    return NextResponse.json(
      { error: "Could not derive brand snapshot from project manifest" },
      { status: 422 },
    );
  }

  const parsedManifest = SlideManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    return NextResponse.json(
      { error: "Manifest failed validation" },
      { status: 422 },
    );
  }
  // Cap to the same slide count templates use.
  const manifest = {
    ...parsedManifest.data,
    slides: parsedManifest.data.slides.slice(0, MAX_TEMPLATE_SLIDES),
  };

  const title = project.templateName ?? project.title;

  let designAnthropicFileId: string;
  try {
    const pdfBytes = await renderDeckPdf(manifest);
    designAnthropicFileId = await uploadFileToAnthropic({
      bytes: pdfBytes,
      fileName: `${title || "deck"}.pdf`,
      contentType: "application/pdf",
    });
  } catch (err) {
    console.error("[use-as-template] reference prep failed", {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Could not prepare the design reference" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    title,
    brand,
    designAnthropicFileId,
    format: brand.format,
    language: brand.language,
  });
}
