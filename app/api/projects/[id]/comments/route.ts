import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveProjectAccess,
  type ProjectRole,
} from "@/lib/api/project-access";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";
import { fanOutNotification } from "@/lib/notifications/server";

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
  // Optional ?ids=foo,bar dereferences specific comment ids — used by
  // the Phase 16.C realtime channel: when a `comment.created` broadcast
  // arrives, the receiving client GETs only the new id(s) instead of
  // re-fetching the full draft list. IDs are filtered through a
  // length + character whitelist so we don't pass arbitrary user
  // input straight into prisma's `IN (…)`. Empty `ids=` (missing or
  // all-rejected) falls through to the normal full-list path so the
  // page-load seed still works.
  const url = new URL(request.url);
  const requestedVersionId = url.searchParams.get("versionId") ?? ctx.versionId;
  const idsParam = url.searchParams.get("ids");
  const requestedIds = idsParam
    ? idsParam
        .split(",")
        .map((s) => s.trim())
        // Prisma cuids are alphanumeric + `_`; cap at 64 chars so a
        // malicious `?ids=` with megabytes can't blow up the SQL.
        .filter((s) => s.length > 0 && s.length <= 64 && /^[a-zA-Z0-9_]+$/.test(s))
    : null;

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
      ...(requestedIds && requestedIds.length > 0
        ? { id: { in: requestedIds } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        // Email omitted on purpose — anyone with `comment` access
        // hits this route, and exposing the email turns the panel
        // into a PII directory. Name + image is all the UI renders.
        select: { id: true, name: true, image: true },
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

  // Refuse to create a comment we can't later authorize for its
  // author. PATCH/DELETE gate ownership on `comment.authorId`, so a
  // null author would orphan the comment — its creator wouldn't be
  // able to edit or delete it. This branch only fires when the
  // prisma user row hasn't been provisioned yet (user-sync race),
  // which the layout's auth gate should already have prevented.
  if (!ctx.authorPrismaUserId) {
    return NextResponse.json(
      { error: "Author not yet provisioned — try again in a moment" },
      { status: 409 },
    );
  }

  // Lock check — a locked slide is a "finalised" slide; the product
  // contract is that lock freezes the slide against further
  // modifications, including new comment markers. The client gates
  // the comment overlay on `slideStates[slideKey].lockedAt` already,
  // but we ALSO enforce server-side so a stale tab (slide locked by
  // a peer mid-session, broadcast not yet received) can't slip a
  // comment through.
  //
  // 423 = Locked. The fetch closer in DeckView's optimistic create
  // path surfaces this via `throwApiError` — matching the 409 / 401
  // / 404 handling pattern already there. Falls through to the
  // generic Arabic fallback if neither side surfaces a specific
  // string, but the response shape includes a message for explicit
  // handling.
  const lockState = await prisma.slideState.findUnique({
    where: {
      presentationId_slideKey: {
        presentationId: ctx.presentationId,
        slideKey: parsed.data.slideId,
      },
    },
    select: { lockedAt: true },
  });
  if (lockState?.lockedAt) {
    return NextResponse.json(
      { error: "Slide is locked — unlock it before adding comments." },
      { status: 423 },
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
      // Required (see guard above) — non-null guarantees the
      // creator can later edit / delete their own comment.
      authorId: ctx.authorPrismaUserId,
    },
    include: {
      author: {
        // Email omitted on purpose — anyone with `comment` access
        // hits this route, and exposing the email turns the panel
        // into a PII directory. Name + image is all the UI renders.
        select: { id: true, name: true, image: true },
      },
    },
  });

  // Phase 16.C — emit a Realtime broadcast so concurrent viewers of
  // the same project see the new comment without refreshing. Payload
  // is pointers-only (commentId, slideId, actorPrismaUserId); the
  // receiving client GETs the full row via `?ids=`. Best-effort —
  // `broadcastToProject` swallows its own errors so a Supabase outage
  // can't roll back a successful Prisma write.
  await broadcastToProject(id, "comment.created", {
    commentId: created.id,
    slideId: created.slideId,
    actorPrismaUserId: ctx.authorPrismaUserId,
  });

  // Phase 16.E — fan-out a bell notification to every project member
  // except the author. Fire-and-forget: never block the POST response
  // on a notification fan-out. The helper handles per-recipient
  // failure isolation + the 10-minute grouping window so a rapid
  // burst of comments from the same author on the same project merges
  // into one bell row instead of N.
  fanOutNotification({
    type: "comment.created",
    projectId: id,
    actorPrismaUserId: ctx.authorPrismaUserId,
    payload: { commentId: created.id, slideKey: created.slideId },
  }).catch((err) => {
    console.warn("[notifications] comment.created fanOut failed", {
      projectId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({ comment: created }, { status: 201 });
}
