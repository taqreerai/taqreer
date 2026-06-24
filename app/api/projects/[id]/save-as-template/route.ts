// POST /api/projects/[id]/save-as-template
//
// Creates a Template row from the project's latest completed manifest,
// then dispatches the template-render Inngest job. The Template carries
// two things: (1) the brand TAGS — derive-brand.ts keeps palette +
// fonts + language + direction + format (used for filtering + to
// pre-fill the Mimic branding card), and (2) the real-deck artifacts —
// the render job produces a multi-page PDF (the "layout", re-uploaded
// to Anthropic Files at use-time to drive the Mimic flow) plus the real
// per-slide thumbnails. The originating project is recorded in
// `Template.sourceProjectId` (non-FK) so the render job can load its
// manifest; deleting the source project does not cascade-delete the
// template (but a template saved before its first completed manifest
// has nothing to render — guarded below).
//
// Templates are intentionally UNTITLED — the community feed shows the
// preview thumbnail only, with no project-derived name that could leak
// private context ("Q4 Pitch — Client X") into the public browser.
//
// Request body:
//   {
//     isPublic: boolean   optional, defaults to false
//   }
//
// Response:
//   201 { ok: true, templateId }
//   400 invalid JSON body
//   401 unauthorised
//   404 project not found / not owned by user / no completed manifest
//   422 manifest present but brand-snapshot derivation failed
//
// Side effects:
//   1. INSERT INTO Template (owner, brand, sourceProjectId,
//      isPublic, publishedAt, language, direction, slideCount,
//      thumbnailUrls=[], pdfUrl=null).
//   2. fire `template.render` Inngest event. The function renders the
//      source deck's real PDF + per-slide thumbnails in the background
//      and writes pdfUrl + thumbnailUrls back. Until then the template
//      renders as a placeholder tile on /templates.
//
// Failure isolation: the Inngest dispatch is wrapped in a catch — a
// dispatch failure logs but does not abort the response, because the
// row already exists and a future trigger (re-render endpoint, or
// even a manual retry) can fill thumbnails later.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectContext } from "@/lib/api/project-context";
import { inngest } from "@/inngest/client";
import { deriveBrandSnapshot } from "@/lib/template/derive-brand";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { MAX_TEMPLATE_SLIDES } from "@/lib/template/constants";
import { revalidateTemplateSurfaces } from "@/lib/auth/marquee-projects";
import type { Prisma } from "@prisma/client";

type SaveAsTemplateBody = {
  isPublic?: unknown;
};

type SaveAsTemplateResponse =
  | { ok: true; templateId: string }
  | { error: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<SaveAsTemplateResponse>> {
  const { id: projectId } = await params;

  const ctx = await resolveProjectContext(projectId);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Body parsing — defensive against malformed JSON. Empty body is
  // VALID (no fields are required) — the client may legitimately POST
  // with no body to accept defaults (private, server-derived title).
  // Per the regen-route precedent (PR #29 CR major #24), return 400
  // on parse failure rather than leaking the underlying SyntaxError.
  let body: SaveAsTemplateBody = {};
  try {
    const text = await request.text();
    if (text.length > 0) body = JSON.parse(text) as SaveAsTemplateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Boolean coercion is strict — anything other than literal true
  // becomes false. Mirrors the regen-route's `replay` handling.
  const isPublic = body.isPublic === true;

  // Project payload needed for derive: language + format + the latest
  // completed manifest. We pull these in one query (rather than
  // re-using resolveProjectContextWithPresentation, which doesn't give
  // us the slideJson) so the route stays a single DB round-trip aside
  // from the eventual create.
  const project = await prisma.project.findFirst({
    where: { id: ctx.project.id },
    select: {
      id: true,
      language: true,
      format: true,
      // The project's own rendered slide thumbnails — the template
      // reuses these as-is (user direction: "save the same images of
      // the project"), capped to MAX_TEMPLATE_SLIDES below.
      thumbnailUrls: true,
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
    // Should be unreachable — resolveProjectContext just confirmed
    // ownership — but defensive in case of a race with project delete.
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
    // Manifest exists but failed BrandSnapshot derivation — likely a
    // legacy/malformed manifest. Surface as 422 so the client can
    // distinguish from "no manifest at all" (404).
    return NextResponse.json(
      { error: "Could not derive brand snapshot from project manifest" },
      { status: 422 },
    );
  }

  // Slide count of the source deck, capped at MAX_TEMPLATE_SLIDES — a
  // template only captures the first few slides (the render job renders
  // the same capped slice to PDF + thumbnails). Best-effort parse;
  // brand derivation already succeeded so the manifest is sound.
  const parsedManifest = SlideManifestSchema.safeParse(manifest);
  const slideCount = parsedManifest.success
    ? Math.min(parsedManifest.data.slides.length, MAX_TEMPLATE_SLIDES)
    : Math.min(3, MAX_TEMPLATE_SLIDES);

  const now = new Date();
  const template = await prisma.template.create({
    data: {
      ownerId: ctx.project.user.id,
      language: brand.language,
      direction: brand.direction,
      slideCount,
      brand: brand as unknown as Prisma.InputJsonValue,
      sourceProjectId: project.id,
      isPublic,
      // publishedAt is the public-feed ordering key. We set it
      // synchronously on the create when isPublic=true; the
      // visibility-toggle route does the same dance on later flips.
      publishedAt: isPublic ? now : null,
      // Seed with the project's real slides so the tile + lightbox show
      // the actual deck immediately. The template-render job then
      // composes the final preview ([cover, typography, palette, ...rest]
      // capped at 10) + the deck PDF (the Mimic reference) in the
      // background.
      thumbnailUrls: project.thumbnailUrls.slice(0, MAX_TEMPLATE_SLIDES),
    },
    select: { id: true },
  });

  // A new PUBLIC template appears on the public surfaces immediately (seeded
  // with the deck's real slides), so purge them. Private -> not shown, skip.
  if (isPublic) {
    await revalidateTemplateSurfaces();
  }

  // Fire-and-forget — see header for failure isolation rationale.
  await inngest
    .send({
      // Per-template dedup key so Inngest's at-least-once delivery
      // doesn't spawn duplicate render runs against the same row.
      id: `template-render:${template.id}`,
      name: "template.render",
      data: { templateId: template.id },
    })
    .catch((err) => {
      console.error(
        "[save-as-template] inngest.send(template.render) failed:",
        err,
      );
    });

  return NextResponse.json(
    { ok: true, templateId: template.id },
    { status: 201 },
  );
}
