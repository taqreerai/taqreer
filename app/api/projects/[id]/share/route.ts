// /api/projects/[id]/share — Owner-only share management.
//
// Two flavours on this path; `[shareId]/route.ts` handles DELETE.
//
// GET    → current share state: { publicAccessLevel, hideBrandingBadge, shares: [] }
// POST   → upsert state. Accepts any subset of:
//            • { publicAccessLevel: "view" | "comment" | "edit" | null }
//              — flips the "anyone-with-link" role. null disables.
//            • { email, accessLevel: "view" | "comment" | "edit" }
//              — adds (or upserts on conflict) a named invitee row,
//                generates an inviteToken. Email send is deferred to
//                Phase 15.3 (logged for now; real Resend wire after
//                the UI/UX is proven).
//          Body can carry both for a single round-trip when the owner
//          changes public-access + adds an invitee in one save click.
//
// Auth: owner-only via `resolveProjectContext`. Non-owners get the
// same 404 that "project doesn't exist" returns — never leak the
// existence of a private deck to a non-owner.

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveProjectContext } from "@/lib/api/project-context";
import { sendShareInvite } from "@/lib/email/send-share-invite";
import { fanOutNotification } from "@/lib/notifications/server";

// Single source of truth for the access-level enum on the wire.
// Matches Prisma's `ProjectAccessLevel` enum exactly so the union
// can pass through without re-typing.
const ACCESS_LEVELS = ["view", "comment", "edit"] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v);
}

// Lowercase + trim for the unique-per-project key. RFC 5321 says the
// local-part is case-sensitive, but in practice every consumer mailbox
// is case-insensitive — normalising here means re-inviting "John@x.com"
// after "john@x.com" upserts the same row instead of stacking two.
function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  // Minimal RFC-5322-ish gate. Detail validation happens via the
  // Resend send later; this stops obvious garbage early.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// 32-byte base64url token — 256 bits of entropy, URL-safe.
// `randomBytes` is cryptographically strong; collision-free at any
// realistic deck count thanks to the @unique constraint on the column.
function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── GET ────────────────────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const ctx = await resolveProjectContext(projectId);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      publicAccessLevel: true,
      hideBrandingBadge: true,
      // Owner — surfaces in the share modal's "Full Access" row at the
      // top of the people list. The share API is the natural place to
      // resolve this (the modal already calls it; the alternative would
      // be a second fetch).
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          // `image` (Google OAuth photo URL) feeds the per-person
          // Avatar in the share modal — the gradient + initial
          // fallback still kicks in for email/password signups. Added
          // 2026-05-24 alongside the avatar-on-the-right row layout.
          image: true,
        },
      },
      shares: {
        // Stable order so the modal's invitee list doesn't reshuffle
        // on every fetch. Newest first — matches the "just added"
        // mental model better than insertion order from the user's PoV.
        orderBy: { invitedAt: "desc" },
        select: {
          id: true,
          email: true,
          accessLevel: true,
          invitedAt: true,
          acceptedAt: true,
          userId: true,
          // JOIN the User row when the invite has been accepted —
          // the modal swaps the "invited email + pending" line for
          // the accepted user's real name + email. Null pre-accept.
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

// ─── POST ───────────────────────────────────────────────────────────
type ShareBody = {
  publicAccessLevel?: AccessLevel | null;
  email?: string;
  accessLevel?: AccessLevel;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const ctx = await resolveProjectContext(projectId);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // `request.json()` happily returns null / arrays / primitives,
  // which then crash on `"key" in body` further down (TypeError →
  // 500). Refuse anything that isn't a plain object up-front.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 },
    );
  }
  const body = raw as ShareBody;

  // Validate before any mutation. The combined "public-access + add
  // invitee" path needs BOTH to be valid before either commits.
  const publicAccessProvided = "publicAccessLevel" in body;
  if (
    publicAccessProvided &&
    body.publicAccessLevel !== null &&
    !isAccessLevel(body.publicAccessLevel)
  ) {
    return NextResponse.json(
      { error: "publicAccessLevel must be view/comment/edit/null" },
      { status: 400 },
    );
  }

  // `inviteEmail` ends up `string | null` after this block — null
  // when the caller didn't supply an `email` field at all (this is
  // an "update public-access only" request). Reject explicitly when
  // body.email is present but doesn't validate, so TypeScript can
  // narrow inviteEmail to `string` after the null check below.
  let inviteEmail: string | null = null;
  if (body.email !== undefined) {
    inviteEmail = normalizeEmail(body.email);
    if (inviteEmail === null) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }
  }
  if (inviteEmail !== null && !isAccessLevel(body.accessLevel)) {
    return NextResponse.json(
      { error: "accessLevel must be view/comment/edit when adding an invitee" },
      { status: 400 },
    );
  }

  // Apply the changes. Wrapped in a single transaction so a partial
  // failure (e.g. public-access flips but invitee upsert fails) doesn't
  // leave the project in a half-committed state.
  const result = await prisma.$transaction(async (tx) => {
    if (publicAccessProvided) {
      await tx.project.update({
        where: { id: projectId },
        data: { publicAccessLevel: body.publicAccessLevel ?? null },
      });
    }
    let newShare = null as null | {
      id: string;
      email: string;
      accessLevel: AccessLevel;
      inviteToken: string | null;
    };
    if (inviteEmail !== null && isAccessLevel(body.accessLevel)) {
      // Lock the project's public link to view-only on EVERY share
      // write (locked-once policy per user direction 2026-05-23: any
      // share existing => publicAccessLevel = "view"). Critically,
      // this `update` (not the previous `updateMany where null`)
      // overrides anything the mixed-body branch above set — closes
      // the bypass where `{publicAccessLevel: "comment", email, ...}`
      // could persist a non-view link.
      await tx.project.update({
        where: { id: projectId },
        data: { publicAccessLevel: "view" },
      });
      // Detect role-only updates so we don't kick already-accepted
      // collaborators. Owner changing "view" → "comment" on an
      // existing accepted share should ONLY flip accessLevel; we
      // keep their inviteToken / acceptedAt / userId intact so the
      // user doesn't have to re-accept. Brand-new invites (no row)
      // and re-invites to an existing-but-not-yet-accepted email
      // still rotate the token + clear acceptedAt — that's the
      // owner's "kick + re-invite" workflow.
      const existing = await tx.projectShare.findUnique({
        where: { projectId_email: { projectId, email: inviteEmail } },
        select: { id: true, accessLevel: true, acceptedAt: true },
      });

      if (existing && existing.acceptedAt) {
        // Role change on an accepted user — non-destructive.
        const updated = await tx.projectShare.update({
          where: { id: existing.id },
          data: { accessLevel: body.accessLevel },
          select: {
            id: true,
            email: true,
            accessLevel: true,
            inviteToken: true,
          },
        });
        newShare = updated;
      } else {
        // New invite OR re-invite of a pending row — rotate token,
        // reset acceptedAt + userId (the new link supersedes any
        // forwarded copy of the old one).
        const upserted = await tx.projectShare.upsert({
          where: { projectId_email: { projectId, email: inviteEmail } },
          create: {
            projectId,
            email: inviteEmail,
            accessLevel: body.accessLevel,
            invitedBy: ctx.project.user.id,
            inviteToken: generateInviteToken(),
          },
          update: {
            accessLevel: body.accessLevel,
            inviteToken: generateInviteToken(),
            acceptedAt: null,
            userId: null,
          },
          select: {
            id: true,
            email: true,
            accessLevel: true,
            inviteToken: true,
          },
        });
        newShare = upserted;
      }
    }
    return { newShare };
  });

  // Email send (Phase 15.F). Non-fatal — if Resend isn't configured
  // or the send fails we still return ok to the client; the share
  // row exists either way and the owner can re-send later. The
  // owner's name/email + the project title are pulled in a tight
  // follow-up query rather than threaded through the transaction
  // (kept the tx pure to its DB writes).
  if (result.newShare?.inviteToken) {
    try {
      const meta = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          title: true,
          user: { select: { name: true, email: true } },
        },
      });
      if (meta) {
        const url = new URL(request.url);
        const appOrigin =
          process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
          `${url.protocol}//${url.host}`;
        await sendShareInvite({
          toEmail: result.newShare.email,
          ownerName: meta.user.name,
          ownerEmail: meta.user.email,
          projectTitle: meta.title,
          accessLevel: result.newShare.accessLevel,
          inviteToken: result.newShare.inviteToken,
          appOrigin,
        });
      }
    } catch (err) {
      // Send failure shouldn't surface to the owner — the share is
      // already persisted. Log + carry on.
      console.error(
        "[share] invite send failed:",
        err instanceof Error ? err.message : "unknown error",
      );
    }
  }

  // Phase 16.E — fan-out a bell notification to the invitee IF they
  // already have an account in our system. New-email invites (no
  // matching User row yet) skip the bell — the email + the post-
  // accept landing on /project/X are enough. Once they accept, the
  // share.accepted route notifies the owner.
  //
  // AWAITED with a bounded 2 s timeout (mirrors the comments route
  // pattern — CR PR #33). The previous detached async IIFE risked
  // Vercel freezing the runtime the moment NextResponse returns,
  // dropping the notification row before Prisma + broadcast finish.
  // Awaiting + Promise.race caps the route's response time at 2 s
  // worst case while still letting the fan-out complete in the
  // background if the Prisma write resolves quickly.
  if (result.newShare?.email) {
    const inviteeEmail = result.newShare.email;
    const inviteeAccessLevel = result.newShare.accessLevel;
    const fanOutPromise = (async () => {
      const invitee = await prisma.user.findUnique({
        where: { email: inviteeEmail },
        select: { id: true },
      });
      if (!invitee) return; // first-touch email — no bell yet
      await fanOutNotification({
        type: "share.invited",
        projectId,
        actorPrismaUserId: ctx.project.user.id,
        payload: { accessLevel: inviteeAccessLevel },
        recipientUserIds: [invitee.id],
      });
    })().catch((err) => {
      console.warn("[notifications] share.invited fanOut failed", {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const fanOutTimeout = new Promise<void>((resolve) =>
      setTimeout(resolve, 2_000),
    );
    await Promise.race([fanOutPromise, fanOutTimeout]);
  }

  return NextResponse.json({ ok: true, share: result.newShare });
}
