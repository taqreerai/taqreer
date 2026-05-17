import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// Drag-box coordinates are persisted in slide-space — slide width/height
// depending on the deck's format. 16:9 → 1920×1080; 9:16 → 1080×1920.
// The larger dimension on either axis is 1920 in both formats, so the
// schema accepts up to 1920 on both x AND y. Tighter, format-specific
// validation is the lightbox's job (it clamps to canvasW/canvasH before
// submit); the API just trusts coordinates are non-negative and finite
// within the absolute envelope.
const BoundsSchema = z.object({
  x: z.number().min(0).max(1920),
  y: z.number().min(0).max(1920),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1920),
});

const CreateCommentSchema = z.object({
  slideId: z.string().min(1).max(128),
  // `.trim().min(1)` rejects whitespace-only content ("   "). Plain
  // `.min(1)` lets all-space strings through and persists effectively
  // empty comments — they look like ghosts on the slide.
  content: z.string().trim().min(1).max(2000),
  boundsJson: BoundsSchema,
});

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

// Resolve an authed user + project + current version in one shot. Returns
// null when the project isn't visible to the caller — caller emits 401/404.
async function resolveContext(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    include: {
      presentation: { select: { id: true, currentVersionId: true } },
    },
  });
  if (!project || !project.presentation || !project.presentation.currentVersionId) {
    return { error: "Project not found" as const, status: 404 };
  }
  return {
    presentationId: project.presentation.id,
    versionId: project.presentation.currentVersionId,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Optional ?versionId=… override — defaults to current version.
  const url = new URL(request.url);
  const requestedVersionId = url.searchParams.get("versionId") ?? ctx.versionId;

  // Drafts only — applied comments are immutable history (the prompt
  // that was actually sent to Claude) and shouldn't surface to the editor.
  const comments = await prisma.comment.findMany({
    where: {
      presentationId: ctx.presentationId,
      versionId: requestedVersionId,
      status: "draft",
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments, versionId: requestedVersionId });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = CreateCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid comment payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const created = await prisma.comment.create({
    data: {
      presentationId: ctx.presentationId,
      versionId: ctx.versionId,
      slideId: parsed.data.slideId,
      content: parsed.data.content,
      boundsJson: toJson(parsed.data.boundsJson),
      status: "draft",
    },
  });

  return NextResponse.json({ comment: created }, { status: 201 });
}
