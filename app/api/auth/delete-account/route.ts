// POST /api/auth/delete-account
//
// GDPR-compliant account deletion. Removes the Prisma User row +
// every owned record (cascades via `onDelete: Cascade` on every
// FK), then removes the authoritative Supabase Auth row.
//
// Order matters: Prisma first, Supabase Auth second. If the Prisma
// delete fails, the auth row stays alive so the user can retry
// (vs. orphaned auth with no Prisma data). If Prisma succeeds but
// Supabase Auth delete fails, the user is effectively wiped from
// the app (no Prisma row → no projects, no presentations) but the
// auth row lingers — the next sign-in would re-create a clean
// Prisma User via `/api/auth/user-sync`.
//
// HISTORY: the previous implementation used `supabase.from(table).
// delete().eq(...)` against snake_case table names that don't exist
// in our schema (Prisma uses PascalCase singular tables with no
// @@map), all wrapped in empty try/catches → every delete silently
// no-op'd, leaving orphaned Project / Presentation / Version /
// SlideState / Comment rows after the auth row was wiped. Replaced
// 2026-05-20 with the Prisma-cascade path.

import { createClient as createServerClient } from "@/lib/supabase/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const limited = rateLimited(`delete-account:${clientIp(request)}`, 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const supabase = await createServerClient();
    // `getUser()` (not `getSession()`) — round-trips to Supabase
    // auth so a forged / stale cookie can't trigger a destructive
    // delete.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUserId = user.id;

    // Prisma cascade — `User.onDelete: Cascade` propagates to
    // Project (and its Presentation / Versions / SlideStates /
    // SlideVersions / Jobs / Files / Comments via their own
    // cascades), BrandKit, Folder, Subscription, UsageEvent.
    // `deleteMany` returns count=0 if there's no Prisma row for
    // this Supabase user — acceptable; we still want to proceed
    // to the auth-row delete so a half-baked sign-up can be wiped.
    await prisma.user.deleteMany({
      where: { supabaseUserId },
    });

    // Admin client (service role) — required to call
    // `auth.admin.deleteUser`.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      supabaseUserId,
    );
    if (deleteError) {
      console.error("[delete-account] auth.admin.deleteUser failed", {
        supabaseUserId,
        error: deleteError.message,
      });
      return NextResponse.json(
        { error: "Failed to delete authentication record" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[delete-account] unexpected error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
