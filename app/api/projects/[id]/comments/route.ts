import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveProjectAccess,
  type ProjectRole,
} from "@/lib/api/project-access";

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

// Resolve authed user + role + presentation/version in one shot. Phase
// 15.A: gated by the minimum required role (comment for create / read /
// delete in this file; "view" callers don't see comments at all).
// The `authorPrismaUserId` field is needed by POST to stamp the
// new comment with its author (Phase 15.D author display).
async function resolveContext(projectId: string, requiredRole: ProjectRole) {
  const access = await resolveProjectAccess(projectId, requiredRole);
  if ("error" in access) {
    return { error: access.error, status: access.status };
  }
  const presentation = await prisma.presentation.findUnique({
    where: { projectId },
    select: { id: true, currentVersionId: true },
  });
  if (!presentation || !presentation.currentVersionId) {
    return { error: "Project not found" as const, status: 404 as const };
  }
  // Translate the supabase userId on `access.user.id` into the
  // prisma User row's id. The two are distinct: supabaseUserId is
  // the auth.users foreign key; we want the application User row.
  let authorPrismaUserId: string | null = null;
  if (access.user.id) {
    const prismaUser = await prisma.user.findUnique({
      where: { supabaseUserId: access.user.id },
      select: { id: true },
    });
    authorPrismaUserId = prismaUser?.id ?? null;
  }
  return {
    role: access.role,
    presentationId: presentation.id,
    versionId: presentation.currentVersionId,
    authorPrismaUserId,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveContext(id, "comment");
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Optional ?versionId=… override — defaults to current version.
  const url = new URL(request.url);
  const requestedVersionId = url.searchParams.get("versionId") ?? ctx.versionId;

  // Drafts only — applied comments are immutable history (the prompt
  // that was actually sent to Claude) and shouldn't surface to the
  // editor. JOIN the author for the panel's per-row display
  // (name / avatar / createdAt). Author is null for pre-Phase-15.D
  // rows; the UI shows "غير معروف" in that case.
  const comments = await prisma.comment.findMany({
    where: {
      presentationId: ctx.presentationId,
      versionId: requestedVersionId,
      status: "draft",
    },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });

  return NextResponse.json({ comments, versionId: requestedVersionId });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveContext(id, "comment");
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
      // Stamp authorship at create-time. Null for the rare case the
      // user has no prisma row yet (user-sync hasn't fired) — the
      // comment still saves; the panel just renders "غير معروف".
      authorId: ctx.authorPrismaUserId,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });

  return NextResponse.json({ comment: created }, { status: 201 });
}
