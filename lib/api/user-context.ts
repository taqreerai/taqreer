// Shared auth helper for routes that only need "who is the caller"
// (no project lookup). Replaces the 4-line preamble — createClient →
// getUser → prisma.user.findUnique(supabaseUserId) — that every
// brand-kits route was re-implementing.
//
// Mirrors the `{ error, status } | { ... }` return shape that
// `resolveProjectContext` uses, so consumers can keep the existing
// `if ("error" in ctx)` pattern.

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type UserContextError = {
  error: "Unauthorized" | "User not found";
  status: 401 | 404;
};

export type UserContext = {
  // Prisma User.id — used to write FKs (BrandKit.userId, etc).
  userId: string;
  // Supabase auth.users.id — used for storage path ownership checks.
  supabaseUserId: string;
};

/**
 * Resolve the signed-in user → internal Prisma User id.
 *
 * Returns 401 when no Supabase session is present, or 404 when the
 * session exists but the corresponding Prisma User row hasn't been
 * synced yet (user-sync race window). Both surfaces stay consistent
 * with the existing brand-kits route behaviour.
 */
export async function resolveUserContext(): Promise<
  UserContext | UserContextError
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) return { error: "User not found", status: 404 };

  return { userId: dbUser.id, supabaseUserId: user.id };
}
