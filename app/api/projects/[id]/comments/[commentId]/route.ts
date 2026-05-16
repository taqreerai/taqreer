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

// Load a comment ONLY if it belongs to a project owned by the authed user
// AND is still in draft status. Applied comments are read-only (they
// represent the prompt that was actually sent to Claude).
async function loadOwnDraft(projectId: string, commentId: string) {
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
  });
  if (!comment) return { error: "Comment not found" as const, status: 404 };
  if (comment.status !== "draft") {
    return { error: "Comment is no longer editable" as const, status: 409 };
  }
  return { comment };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const loaded = await loadOwnDraft(id, commentId);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = PatchCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid patch payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: {
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
      ...(parsed.data.boundsJson !== undefined
        ? { boundsJson: toJson(parsed.data.boundsJson) }
        : {}),
    },
  });

  return NextResponse.json({ comment: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const loaded = await loadOwnDraft(id, commentId);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  await prisma.comment.delete({ where: { id: commentId } });
  return NextResponse.json({ ok: true });
}
