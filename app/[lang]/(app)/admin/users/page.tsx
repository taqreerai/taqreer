// Admin > Users (server). Gates on admin, fetches real users + their spendable
// credit balance + ban status, and renders the interactive client. The list,
// grant-credits, and ban/unban actions are all wired to real backends.

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { getBalance } from "@/lib/credits/server";
import { sanitizeCity } from "@/lib/api/geo";
import { UsersClient } from "@/components/admin/UsersClient";
import type { AdminUser, Plan } from "@/lib/admin/mock";

export const dynamic = "force-dynamic";

const PLAN_SET = new Set(["free", "plus", "pro", "max"]);
function asPlan(p: string): Plan {
  return (PLAN_SET.has(p) ? p : "free") as Plan;
}

export default async function AdminUsersPage() {
  await requireAdminPage();

  // Exclude admins from the managed-users list - the console operator (dev@)
  // isn't someone you grant credits to or ban here, so admins never appear.
  const rows = await prisma.user.findMany({
    where: { role: { not: "admin" } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      createdAt: true,
      bannedAt: true,
      signupIp: true,
      signupCountry: true,
      signupCity: true,
    },
  });

  // Multi-account signal: users sharing a signup IP. Computed within the
  // take-500 window above (currently the whole user base).
  const ipCounts = new Map<string, number>();
  for (const u of rows) {
    if (u.signupIp) ipCounts.set(u.signupIp, (ipCounts.get(u.signupIp) ?? 0) + 1);
  }

  // Spendable balance per user. N+1 is fine at admin scale; revisit with a
  // single aggregate query if the user count grows large.
  const users: AdminUser[] = await Promise.all(
    rows.map(async (u) => {
      const balance = await getBalance(u.id);
      return {
        id: u.id,
        name: u.name?.trim() || u.email.split("@")[0] || "User",
        email: u.email,
        plan: asPlan(u.plan),
        credits: balance.total,
        subscriptionCredits: balance.subscription,
        joinedAt: u.createdAt.toISOString().slice(0, 10),
        banned: !!u.bannedAt,
        signupIp: u.signupIp,
        signupCountry: u.signupCountry,
        // Re-sanitized on read: rows stored before the mojibake repair in
        // sanitizeCity carry double-encoded names (UTF-8 bytes read as
        // latin-1); the repair is idempotent for clean values.
        signupCity: sanitizeCity(u.signupCity),
        sharedIp: !!u.signupIp && (ipCounts.get(u.signupIp) ?? 0) > 1,
      };
    }),
  );

  return <UsersClient initialUsers={users} />;
}
