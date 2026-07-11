// Admin-only auth guards. The (app) layout already enforces "is signed in";
// these add "is an admin" (User.role === "admin"). The page guard 404s a
// non-admin so the console's existence stays hidden; the API guard returns a
// 403 JSON envelope.
//
// role lives on the Prisma User row (not the Supabase JWT), so both guards do a
// findUnique on supabaseUserId. Grant an admin with:
//   tsx scripts/set-admin.ts <email>

import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type AdminContext = {
  // Prisma User.id
  userId: string;
  // Supabase auth.users.id
  supabaseUserId: string;
};

// getUser() round-trips to Supabase auth (a forged/stale cookie can't pass),
// then role is read from the Prisma row. Returns null for "not an admin" (no
// session, no synced row, or role !== admin) so callers pick the response.
async function resolveAdmin(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, role: true, bannedAt: true },
  });
  // A banned admin is treated as a non-admin: a still-valid session must not
  // keep admin power (e.g. self-unban, or granting itself credits).
  if (!dbUser || dbUser.role !== "admin" || dbUser.bannedAt) return null;

  return { userId: dbUser.id, supabaseUserId: user.id };
}

/**
 * Server-component guard. notFound() (404) a non-admin so the console's
 * existence stays hidden, then returns the admin context for the page to use.
 * The surrounding (app) layout has already redirected unauthenticated users.
 */
export async function requireAdminPage(): Promise<AdminContext> {
  const ctx = await resolveAdmin();
  if (!ctx) notFound();
  return ctx;
}

/**
 * Route-handler guard. Returns the admin context, or a ready 403 response.
 * Usage:
 *   const ctx = await requireAdminApi();
 *   if ("error" in ctx) return ctx.error;
 */
export async function requireAdminApi(): Promise<
  AdminContext | { error: NextResponse }
> {
  const ctx = await resolveAdmin();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return ctx;
}

/**
 * Lightweight admin predicate for the owner-scoped routes (project/template
 * delete, rename, visibility) that already have the caller's Supabase user id
 * in hand and just need to widen their owner filter for a superuser. Same trust
 * chain as requireAdminApi (Prisma User.role, banned admins excluded), minus the
 * extra auth.getUser() round-trip. Returns false for a missing/non-admin/banned
 * row so a non-admin keeps its existing owner-only scope.
 */
export async function isAdminSupabaseUser(
  supabaseUserId: string,
): Promise<boolean> {
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId },
    select: { role: true, bannedAt: true },
  });
  return !!dbUser && dbUser.role === "admin" && !dbUser.bannedAt;
}
