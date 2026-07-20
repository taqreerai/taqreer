// GET /api/projects/[id]/manifest — return the project's latest completed
// SlideManifest + the project-level `format` fallback.
//
// Used by the Share modal's Export tab when the modal is opened from
// outside the editor (project tile 3-dots → Share). Inside the editor
// the manifest is already in scope and passed as a prop; from the tile
// we don't have it, so the modal lazy-fetches via this endpoint to
// power the client-side PPTX + HTML exports (which need the rendered
// manifest in the browser).
//
// Owner-only via `resolveProjectContext`. 404 when:
//   • project doesn't exist or caller doesn't own it
//   • presentation has no completed version yet (deck still generating)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { SlideManifestSchema } from "@/lib/schema/slide";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // Phase 15.A — view access required (manifest also drives the
  // Share modal's Export tab for any viewer who can see the deck).
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      format: true,
      // Flow discriminator so the Share Export tab, opened from a project
      // tile (no `isSocial` prop), still limits social decks to PDF/PNG at
      // ANY ratio (incl. 9:16/16:9, which format alone can't distinguish).
      type: true,
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
  const slideJson = project.presentation?.versions[0]?.slideJson;
  if (!slideJson) {
    return NextResponse.json(
      { error: "Project has no completed manifest yet" },
      { status: 404 },
    );
  }
  // Runtime-validate the persisted JSON so the client doesn't crash
  // on a malformed payload. Same recipe save-as-template uses.
  const parsed = SlideManifestSchema.safeParse(slideJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Stored manifest is malformed" },
      { status: 422 },
    );
  }
  return NextResponse.json({
    manifest: parsed.data,
    format: project.format,
    isSocial: project.type === "social",
  });
}
