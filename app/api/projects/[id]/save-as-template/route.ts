// POST /api/projects/[id]/save-as-template
//
// Creates a Template row from the project's latest completed manifest,
// then dispatches the showcase-render Inngest job. The Template is
// "brand-only" by construction — derive-brand.ts strips out logo,
// project title, and slide content, keeping only palette + fonts +
// language + direction + format. The originating project is recorded
// in `Template.sourceProjectId` purely for provenance ("which deck
// did this come from"); it's a non-FK pointer so deleting the source
// project does not cascade-delete the template.
//
// Request body:
//   {
//     isPublic: boolean   optional, defaults to false
//   }
//
// `title` is intentionally NOT a client-supplied field — the user does
// NOT name templates by hand. The server uses `Project.templateName`
// (the Claude-Haiku-generated 2-3 word evocative name set at deck-
// generate time, e.g. "نجم الليل البعيد") as the canonical template
// title. This keeps the public templates feed free of project-specific
// names that could leak private context ("Q4 Pitch — Client X") into
// the community browser. Falls back to `Project.title` for legacy
// projects with null `templateName` (defensive — all production rows
// have been backfilled).
//
// Response:
//   201 { ok: true, templateId }
//   400 invalid JSON body
//   401 unauthorised
//   404 project not found / not owned by user / no completed manifest
//   422 manifest present but brand-snapshot derivation failed
//
// Side effects:
//   1. INSERT INTO Template (owner, title, brand, sourceProjectId,
//      isPublic, publishedAt, language, direction, slideCount=3,
//      thumbnailUrls=[]).
//   2. fire `template.showcase.render` Inngest event. The function
//      renders the 3 brand-showcase PNGs in the background (cover +
//      typography + palette — the abstract layout slide was retired
//      2026-05-22) and writes thumbnailUrls back. Until then the
//      template renders as a placeholder tile on /templates.
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
      title: true,
      // templateName is the canonical title source. See route header
      // for why the user can't override it from the client.
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

  // Server-derived title: prefer templateName (Haiku-generated), fall
  // back to the project's own title for legacy projects pre-backfill.
  // The fallback should be unreachable in production (all rows have
  // been backfilled) but keeps the route robust if a brand-new project
  // somehow lands here before its templateName Haiku call completes.
  const title = project.templateName ?? project.title;

  const now = new Date();
  const template = await prisma.template.create({
    data: {
      ownerId: ctx.project.user.id,
      title,
      language: brand.language,
      direction: brand.direction,
      // Brand showcase is 3 slides as of 2026-05-22 (cover +
      // typography + palette). The schema column default is still 4
      // for legacy rows; new rows override here so the count matches
      // the actual rendered output. (`SHOWCASE_SLIDE_IDS.length` is
      // the source of truth in `lib/template/build-showcase-html.ts`.)
      slideCount: 3,
      brand: brand as unknown as Prisma.InputJsonValue,
      sourceProjectId: project.id,
      isPublic,
      // publishedAt is the public-feed ordering key. We set it
      // synchronously on the create when isPublic=true; the
      // visibility-toggle route does the same dance on later flips.
      publishedAt: isPublic ? now : null,
      thumbnailUrls: [],
    },
    select: { id: true },
  });

  // Fire-and-forget — see header for failure isolation rationale.
  await inngest
    .send({
      // Per-template dedup key so Inngest's at-least-once delivery
      // doesn't spawn duplicate render runs against the same row.
      id: `template-showcase:${template.id}`,
      name: "template.showcase.render",
      data: { templateId: template.id },
    })
    .catch((err) => {
      console.error(
        "[save-as-template] inngest.send(template.showcase.render) failed:",
        err,
      );
    });

  return NextResponse.json(
    { ok: true, templateId: template.id },
    { status: 201 },
  );
}
