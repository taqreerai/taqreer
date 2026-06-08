// POST /api/projects/[id]/slides/[slideKey]/edit
//
// Body: { html: string }
//
// Persists a manual (hand-edited) slide from the in-canvas editor as a new
// SlideVersion and splices it into the active manifest — the synchronous twin
// of the /restore route, but with brand-new HTML instead of a stored version.
// No Inngest / Claude in the loop: a manual edit is just sanitise → write →
// broadcast.
//
// The HTML is sanitised SERVER-SIDE (sanitizeSlideHtmlServer, JSDOM) before it
// touches the DB — we never trust client HTML. Sanitising is idempotent
// (verified across real slides), so the stored, already-sanitised DOM
// round-trips through render unchanged.
//
// Returns 400 on a bad/empty body, 413 on an oversized payload, 404 if the
// project/slide is gone, 200 with the new active slide JSON + currentVersionNumber.
// The actor swaps in place from the response; a `slide.regen.finished` broadcast
// nudges peers to re-fetch (the generic "slide content changed" event — no bell
// notification, unlike a regen).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { updateSlideContentInPlace } from "@/lib/db/slide-versioning";
import { sanitizeSlideHtmlServer } from "@/lib/export/sanitize-server";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

type EditPayload = { html?: unknown };

// A slide's HTML is ~10 KB. Cap well above that but low enough that a runaway or
// abusive payload can't balloon the PresentationVersion row.
const MAX_HTML_BYTES = 512 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Edit access required (mirrors the regen / restore routes).
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = (await request.json().catch(() => ({}))) as EditPayload;
  if (typeof body.html !== "string" || body.html.trim() === "") {
    return NextResponse.json(
      { error: "html must be a non-empty string" },
      { status: 400 },
    );
  }
  if (body.html.length > MAX_HTML_BYTES) {
    return NextResponse.json({ error: "html too large" }, { status: 413 });
  }

  // Server-side sanitise — never store unsanitised client HTML. Fail-closed:
  // sanitizeSlideHtmlServer returns "" on a sanitiser error; reject that rather
  // than persisting (and rendering) an empty slide.
  const clean = sanitizeSlideHtmlServer(body.html);
  if (clean.trim() === "") {
    return NextResponse.json(
      { error: "Sanitised HTML was empty" },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { presentation: { select: { id: true } } },
  });
  if (!project?.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let result;
  try {
    result = await updateSlideContentInPlace(
      prisma,
      project.presentation.id,
      slideKey,
      clean,
    );
  } catch (err) {
    console.error("[slides/edit] updateSlideContentInPlace failed:", err);
    return NextResponse.json({ error: "Failed to save edit" }, { status: 500 });
  }
  if (!result) {
    return NextResponse.json(
      { error: "Slide not found in this deck" },
      { status: 404 },
    );
  }

  // Nudge peers to re-fetch + swap in place (the actor updates locally from the
  // response below). Reuses the existing slide-content-changed broadcast; the
  // handler skips the actor's own echo via actorPrismaUserId. Fire-and-forget —
  // the version is already persisted, so a dropped broadcast only defers a
  // peer's refresh, it never loses data.
  void broadcastToProject(projectId, "slide.regen.finished", {
    slideId: slideKey,
    actorPrismaUserId: access.user.prismaId,
  }).catch((err) => {
    console.error("[slides/edit] broadcast failed:", err);
  });

  // In-place content update — no version row, so no currentVersionNumber. The
  // client undo/redo stack is local; history checkpoints come from /checkpoint.
  return NextResponse.json({ slide: result.slide });
}
