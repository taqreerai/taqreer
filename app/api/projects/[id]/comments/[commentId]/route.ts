import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

// Same envelope as POST — 1920 on both axes covers 16:9 (1920×1080) and
// 9:16 (1080×1920). Format-specific tightening is the lightbox's job.
const BoundsSchema = z.object({
  x: z.number().min(0).max(1920),
  y: z.number().min(0).max(1920),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1920),
});

const PatchCommentSchema = z
  .object({
    // `.trim().min(1)` rejects whitespace-only PATCH content, same as
    // the create route — without it, "   " sneaks past `.min(1)` and
    // turns a real comment into a blank one.
    content: z.string().trim().min(1).max(2000).optional(),
    boundsJson: BoundsSchema.optional(),
  })
  .refine((v) => v.content !== undefined || v.boundsJson !== undefined, {
    message: "At least one of content or boundsJson is required",
  });

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Phase 15.A / 15.D auth helper.
//
// Project-level gate: caller must have at least `comment` access
// (owner / edit-share / comment-share). View-only callers can't
// touch comments.
//
// Per-comment authorship gate: edit + delete a comment is only
// allowed when EITHER
//   • caller is the comment's author, OR
//   • caller is the project owner (moderation power — they can
//     prune any comment on their own deck)
//
// Anything else (comment-share trying to delete someone else's
// comment) gets 403. The write itself (below) does the draft-
// status check atomically to close the read-then-write TOCTOU
// window for the lifecycle transition draft→applied.
async function authoriseProject(projectId: string, commentId: string) {
  const access = await resolveProjectAccess(projectId, "comment");
  if ("error" in access) return { error: access.error, status: access.status };

  // Resolve the caller's prisma user id for the authorship check.
  let callerPrismaUserId: string | null = null;
  if (access.user.id) {
    const u = await prisma.user.findUnique({
      where: { supabaseUserId: access.user.id },
      select: { id: true },
    });
    callerPrismaUserId = u?.id ?? null;
  }

  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      presentation: { project: { id: projectId } },
    },
    // `slideId` surfaces here so DELETE can include it in the
    // `comment.deleted` broadcast payload AFTER the row is gone —
    // we can't read it back from prisma post-delete.
    select: { id: true, authorId: true, slideId: true },
  });
  if (!comment) {
    return { error: "Comment not found" as const, status: 404 as const };
  }

  const isOwner = access.role === "owner";
  const isAuthor =
    callerPrismaUserId !== null && comment.authorId === callerPrismaUserId;
  if (!isOwner && !isAuthor) {
    return { error: "Forbidden" as const, status: 403 as const };
  }

  return {
    commentId: comment.id,
    slideId: comment.slideId,
    callerPrismaUserId,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const authd = await authoriseProject(id, commentId);
  if ("error" in authd) {
    return NextResponse.json({ error: authd.error }, { status: authd.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid patch payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Conditional write — only mutates when the row is STILL a draft.
  // Closes the gap where a concurrent /regenerate-partial promotes the
  // draft to "applied" between an earlier status read and this update.
  const result = await prisma.comment.updateMany({
    where: { id: commentId, status: "draft" },
    data: {
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
      ...(parsed.data.boundsJson !== undefined
        ? { boundsJson: toJson(parsed.data.boundsJson) }
        : {}),
    },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { error: "Comment is no longer editable" },
      { status: 409 },
    );
  }

  const updated = await prisma.comment.findUnique({ where: { id: commentId } });
  return NextResponse.json({ comment: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const authd = await authoriseProject(id, commentId);
  if ("error" in authd) {
    return NextResponse.json({ error: authd.error }, { status: authd.status });
  }

  // Conditional delete — same TOCTOU guard as PATCH.
  const result = await prisma.comment.deleteMany({
    where: { id: commentId, status: "draft" },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { error: "Comment is no longer editable" },
      { status: 409 },
    );
  }

  // Phase 16.C — emit a Realtime broadcast so concurrent viewers
  // drop the marker / panel row without refreshing. Payload pointers
  // were captured in `authoriseProject` BEFORE the delete (slideId
  // would be unreadable from prisma post-delete). Best-effort —
  // `broadcastToProject` swallows its own errors so a Supabase outage
  // can't roll back a successful Prisma delete.
  await broadcastToProject(id, "comment.deleted", {
    commentId: authd.commentId,
    slideId: authd.slideId,
    actorPrismaUserId: authd.callerPrismaUserId,
  });
  return NextResponse.json({ ok: true });
}
