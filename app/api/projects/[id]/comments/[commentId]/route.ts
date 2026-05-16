import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const BoundsSchema = z.object({
  x: z.number().min(0).max(1920),
  y: z.number().min(0).max(1080),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1080),
});

const PatchCommentSchema = z
  .object({
    content: z.string().min(1).max(2000).optional(),
    boundsJson: BoundsSchema.optional(),
  })
  .refine((v) => v.content !== undefined || v.boundsJson !== undefined, {
    message: "At least one of content or boundsJson is required",
  });

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Authorise the caller against the project owning this comment WITHOUT
// reading the comment's current status — the write itself (below) does
// the draft-status check atomically to close the read-then-write TOCTOU
// window.
async function authoriseProject(projectId: string, commentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      presentation: {
        project: { id: projectId, user: { supabaseUserId: user.id } },
      },
    },
    select: { id: true },
  });
  if (!comment) return { error: "Comment not found" as const, status: 404 };
  return { commentId: comment.id };
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
  return NextResponse.json({ ok: true });
}
