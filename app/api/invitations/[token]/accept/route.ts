// GET /api/invitations/[token]/accept — claim an invite link.
//
// Flow:
//   1. Anonymous → redirect to /login?next=/api/invitations/[token]/accept
//      (login page bounces back after sign-in / signup).
//   2. Authenticated → upsert the prisma User row (mirrors user-sync
//      so a brand-new signup who came in through an invite is
//      definitely linked before we set userId on the share).
//   3. Look up the share by inviteToken. 404 if absent, 410 if the
//      token has been rotated (the owner re-invited or revoked).
//   4. Link the share to the current user + set acceptedAt = now.
//      Idempotent — re-clicking the link is a no-op on already-
//      accepted rows for the same user (we keep acceptedAt stable).
//   5. Redirect to /project/[projectId] so the invitee lands inside
//      the deck immediately.
//
// Security notes:
//   • If an invite was sent to email A but a signed-in user with
//     email B clicks it, we still link the SIGNED-IN user. The
//     token IS the bearer credential — anyone with the URL gets
//     access. This matches industry behaviour (Notion / Linear)
//     for shareable invite links.
//   • Token rotation: the owner's "kick + re-invite" workflow
//     regenerates inviteToken on every share POST, which inerts
//     the old URL. We detect that via the not-found path here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { fanOutNotification } from "@/lib/notifications/server";
import { siteOrigin } from "@/lib/api/site-origin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // External origin, NOT request.url (= localhost:3100 in a prod route handler).
  const origin = siteOrigin(request);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Bounce through login. Build an absolute URL so Supabase's
    // login flow can preserve it through email-confirmation
    // redirects (relative URLs don't round-trip well there).
    const next = `${origin}/api/invitations/${encodeURIComponent(token)}/accept`;
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  // Mirror user-sync's upsert so brand-new signups have a prisma
  // User row before we link the share. Same shape; we don't depend
  // on user-sync having been called yet.
  const profile = {
    email: user.email ?? `${user.id}@supabase.local`,
    name:
      (user.user_metadata?.name as string | undefined) ??
      (user.user_metadata?.full_name as string | undefined) ??
      null,
    image:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
  const prismaUser = await prisma.user.upsert({
    where: { supabaseUserId: user.id },
    update: profile,
    create: { supabaseUserId: user.id, ...profile, plan: "free" },
    select: { id: true },
  });

  const share = await prisma.projectShare.findUnique({
    where: { inviteToken: token },
    select: { id: true, projectId: true, acceptedAt: true, userId: true },
  });
  if (!share) {
    // Token rotated / never existed / revoked.
    return NextResponse.json(
      { error: "Invitation is no longer valid" },
      { status: 410 },
    );
  }

  // Link userId + stamp acceptedAt. If the same user re-clicks an
  // already-accepted invite, we keep the original acceptedAt
  // (idempotent — only flip it the first time). The
  // `firstTimeAccept` flag drives whether we fire the bell
  // notification — re-clicking the same accept link shouldn't
  // re-notify the owner.
  const firstTimeAccept = !share.acceptedAt;
  if (firstTimeAccept || share.userId !== prismaUser.id) {
    await prisma.projectShare.update({
      where: { id: share.id },
      data: {
        userId: prismaUser.id,
        acceptedAt: share.acceptedAt ?? new Date(),
      },
    });
  }

  // Phase 16.E — notify the project owner that the invitee accepted.
  // Only fires on FIRST-time acceptance to avoid bell spam if the
  // user revisits the accept link. We fetch the share's accessLevel
  // separately because the initial findUnique above kept its select
  // minimal; this second query is incurred only on the first-accept
  // branch.
  if (firstTimeAccept) {
    (async () => {
      try {
        const meta = await prisma.projectShare.findUnique({
          where: { id: share.id },
          select: {
            accessLevel: true,
            project: { select: { userId: true } },
          },
        });
        if (!meta || !meta.project) return;
        await fanOutNotification({
          type: "share.accepted",
          projectId: share.projectId,
          actorPrismaUserId: prismaUser.id,
          payload: { accessLevel: meta.accessLevel },
          recipientUserIds: [meta.project.userId],
        });
      } catch (err) {
        console.warn("[notifications] share.accepted fanOut failed", {
          projectId: share.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  // Land them inside the deck.
  return NextResponse.redirect(
    new URL(`/project/${share.projectId}`, origin),
  );
}
