// DELETE /api/admin/users/[id] - admin permanently deletes a user.
//
// Admin-only (requireAdminApi). Hard-deletes the Prisma User row - cascading to
// their projects / decks / ledger / notifications via the schema's onDelete:
// Cascade FKs - then removes the authoritative Supabase Auth identity, so the
// account is gone from everywhere. IRREVERSIBLE. Refuses to delete an admin or
// the calling admin.
//
// Order mirrors /api/auth/delete-account: Prisma first (a Prisma failure leaves
// the login alive to retry), Supabase Auth second.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;

  // An admin can't delete themselves out of the console.
  if (id === ctx.userId) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, supabaseUserId: true },
    });
    if (!target) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }
    // Admins aren't managed (or deletable) from this console.
    if (target.role === "admin") {
      return NextResponse.json({ error: "cannot_delete_admin" }, { status: 400 });
    }

    // Prisma first - cascades to all owned data.
    await prisma.user.delete({ where: { id } });

    // Supabase Auth second - the authoritative login identity.
    if (target.supabaseUserId) {
      const { error } = await getSupabaseAdmin().auth.admin.deleteUser(
        target.supabaseUserId,
      );
      if (error) {
        // App data is gone but the auth identity lingers. Surface it so the
        // operator can clear it in the Supabase dashboard.
        console.error("[admin/users/delete] auth.admin.deleteUser failed", {
          id,
          supabaseUserId: target.supabaseUserId,
          error: error.message,
        });
        return NextResponse.json({ ok: true, authDeleted: false });
      }
    }

    return NextResponse.json({ ok: true, authDeleted: true });
  } catch (err) {
    console.error("[admin/users/delete] unexpected error", err);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
