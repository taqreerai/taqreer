// Shared ban check for inline-auth routes.
//
// The auth resolvers (resolveUserContext / resolveProjectContext /
// resolveProjectAccess) fold the User.bannedAt check into their own user
// lookup. Routes that resolve the Supabase user inline (storage uploads,
// extract, datasheet parse, etc.) call this right after getUser() to reject a
// suspended account. A banned user keeps a valid Supabase session, so this
// local DB flag is the server-side enforcement point.

import { prisma } from "@/lib/prisma";

export async function isBannedSupabaseUser(
  supabaseUserId: string,
): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { supabaseUserId },
    select: { bannedAt: true },
  });
  return Boolean(u?.bannedAt);
}
