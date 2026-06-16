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
  error:
    | "Unauthorized"
    | "User not found"
    | "Auth backend unavailable"
    | "Account suspended";
  status: 401 | 404 | 503 | 403;
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
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError) {
    // Distinguish "no session" (normal unauth state, returns
    // AuthSessionMissingError or similar with a benign message)
    // from genuine backend failures. We treat the AuthSessionMissing
    // and AuthApiError-with-401 cases as 401, everything else as
    // 503 so transient network/backend issues don't get logged
    // as "user not authenticated" — that misclassification hides
    // real outages behind benign-looking metrics.
    const isSessionMissing =
      authError.name === "AuthSessionMissingError" ||
      ("status" in authError && authError.status === 401);
    if (isSessionMissing) {
      return { error: "Unauthorized", status: 401 };
    }
    console.error("[user-context] getUser failed", {
      name: authError.name,
      status: "status" in authError ? authError.status : undefined,
      message: authError.message,
    });
    return { error: "Auth backend unavailable", status: 503 };
  }
  if (!data.user) return { error: "Unauthorized", status: 401 };
  const user = data.user;

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, bannedAt: true },
  });
  if (!dbUser) return { error: "User not found", status: 404 };
  // A banned user keeps a valid Supabase session; reject mutations server-side.
  if (dbUser.bannedAt) return { error: "Account suspended", status: 403 };

  return { userId: dbUser.id, supabaseUserId: user.id };
}
