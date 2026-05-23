// GET /api/projects/[id]/template-preview
//
// Lazy-load endpoint for the "Save as template" modal. The dashboard
// and /projects tile fetches don't carry brand/manifest data because
// only a tiny fraction of tiles ever open this modal — eager-loading
// the brand snapshot on every tile would bloat the page response.
//
// The modal calls this when it opens, then renders the live preview
// (heading + body font samples + palette swatches) from the response.
//
// Response shape mirrors what the modal needs:
//   { defaultTitle, brand: BrandSnapshot }
//
// `defaultTitle` is Project.templateName (the Claude-Haiku-generated
// 2-3 word evocative name set at deck-generate time). Falls back to
// Project.title if templateName is null (legacy projects pre-backfill,
// though all production rows have been backfilled — defensive).
//
// Auth: owner-only via resolveProjectContext.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectContext } from "@/lib/api/project-context";
import {
  deriveBrandSnapshot,
  type BrandSnapshot,
} from "@/lib/template/derive-brand";

type TemplatePreviewResponse =
  | { defaultTitle: string; brand: BrandSnapshot }
  | { error: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<TemplatePreviewResponse>> {
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
  const manifest = project.presentation?.versions[0]?.slideJson;
  if (!manifest) {
    return NextResponse.json(
      { error: "Project has no completed manifest yet" },
      { status: 404 },
    );
  }
  const brand = deriveBrandSnapshot({ project, manifest });
  if (!brand) {
    return NextResponse.json(
      { error: "Could not derive brand snapshot from project manifest" },
      { status: 422 },
    );
  }

  return NextResponse.json({
    defaultTitle: project.templateName ?? project.title,
    brand,
  });
}
