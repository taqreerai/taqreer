// Role-aware project access helper. Extends `resolveProjectContext`
// (owner-only) to also recognise accepted ProjectShare invitees and
// the project's `publicAccessLevel` public link.
//
// Roles, ascending:
//   view   — viewers (accepted view-share OR public-view link, no auth)
//   comment — accepted comment-share (can create comments, no regen)
//   edit    — accepted edit-share (co-owner on the same project row)
//   owner   — project creator
//
// `requiredRole` is the MINIMUM the caller needs. The helper either
// returns `{ role, project, user }` or `{ error, status }` in the
// same shape `resolveProjectContext` uses, so consumers can keep
// the existing `if ("error" in ctx)` pattern.

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type ProjectRole = "owner" | "edit" | "comment" | "view";

const ROLE_RANK: Record<ProjectRole, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  owner: 3,
};

export type ProjectAccessError = {
  error: "Unauthorized" | "Project not found" | "Forbidden";
  status: 401 | 403 | 404;
};

export type ProjectAccessContext = {
  role: ProjectRole;
  // `id` here is the Supabase user id (from auth.users); `prismaId`
  // is the application User row id. We expose both because routes
  // mix usage — some compare against Supabase ids (e.g. ownership),
  // some need the prisma row id to write FKs (e.g. Comment.authorId,
  // ProjectShare.userId). Both null for anonymous public-view callers.
  user: { id: string | null; prismaId: string | null };
  project: {
    id: string;
    user: { id: string };
  };
};

/**
 * Resolve project access for the current request.
 *
 * Lookup order:
 *  1. Owner — project.user.supabaseUserId === supabase user id
 *  2. Accepted share — projectShare row with userId matching the
 *     signed-in user AND acceptedAt is not null.
 *  3. Public view — project.publicAccessLevel = "view" AND
 *     requiredRole is "view" (public links never grant comment/edit).
 *
 * Returns a 404 (never 403) for unauthorized callers on a real
 * project — same existence-hiding contract `resolveProjectContext`
 * already follows. 401 only when the route requires an authenticated
 * caller but none is present AND the public fallback doesn't apply.
 */
export async function resolveProjectAccess(
  projectId: string,
  requiredRole: ProjectRole,
): Promise<ProjectAccessContext | ProjectAccessError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      publicAccessLevel: true,
      user: { select: { id: true, supabaseUserId: true } },
      // Pull the caller's share row in the same query when signed in.
      // Include BOTH accepted-active rows AND revoked rows — the
      // revoked path needs to DENY the caller (overrides the
      // public-link fallback) per user direction 2026-05-26
      // "revoked user still can access through the link." Pending
      // (not-yet-accepted, not-revoked) rows are excluded — they
      // grant no access until the invitee opens the invite URL.
      shares: user
        ? {
            where: {
              user: { supabaseUserId: user.id },
              OR: [
                { acceptedAt: { not: null }, revokedAt: null },
                { revokedAt: { not: null } },
              ],
            },
            select: { accessLevel: true, userId: true, revokedAt: true },
            take: 1,
          }
        : false,
    },
  });
  if (!project) {
    return { error: "Project not found", status: 404 };
  }

  // Resolve the caller's role against this project.
  let role: ProjectRole | null = null;
  let userIdForCtx: string | null = null;
  let prismaUserIdForCtx: string | null = null;
  // True when this signed-in user was explicitly revoked from this
  // project. Blocks the public-link fallback below — the explicit
  // revoke must outrank "anyone with the link can view."
  let explicitlyRevoked = false;

  if (user) {
    userIdForCtx = user.id;
    if (project.user.supabaseUserId === user.id) {
      role = "owner";
      // Owner's prisma user id is the project's user.id.
      prismaUserIdForCtx = project.user.id;
    } else {
      const share = project.shares?.[0];
      if (share) {
        if (share.revokedAt) {
          // Soft-deleted share: the owner kicked this user out.
          // Mark as explicitly revoked so the public-link fallback
          // below doesn't grant them view-access via the URL.
          explicitlyRevoked = true;
          prismaUserIdForCtx = share.userId ?? null;
        } else {
          role = share.accessLevel as ProjectRole;
          // Share carries the invitee's prisma userId directly —
          // available because accept set it on the row.
          prismaUserIdForCtx = share.userId ?? null;
        }
      }
    }
  }

  // Public-view fallback — only when the caller hasn't already
  // matched a stronger role, the project's link is on, AND the
  // caller wasn't explicitly revoked. The revoke check is what
  // gives "remove from sharing" its teeth on public-link projects:
  // without it, the kicked user could still re-open the project via
  // the public URL.
  if (!role && !explicitlyRevoked && project.publicAccessLevel === "view") {
    role = "view";
  }

  if (!role) {
    // Hide existence of private projects from non-owners. Mirrors
    // `resolveProjectContext`. Anonymous viewers on a non-public
    // project also fall through to 404 (we don't want to leak the
    // distinction "wrong account" vs "not shared").
    return { error: "Project not found", status: 404 };
  }

  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    // Caller has SOME access but not enough for this operation.
    // 403 (not 404) — they know the deck exists, the operation is
    // the thing being refused.
    return { error: "Forbidden", status: 403 };
  }

  return {
    role,
    user: { id: userIdForCtx, prismaId: prismaUserIdForCtx },
    project: { id: project.id, user: { id: project.user.id } },
  };
}
