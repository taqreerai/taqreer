import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const supabase = await createServerClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Admin client uses the service role key to bypass RLS
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Delete user data in FK-safe order (ignore errors for tables not yet created)
    const tables = [
      "usage_events",
      "comments",
      "jobs",
      "files",
      "presentation_versions",
      "presentations",
      "projects",
      "brand_kits",
      "subscriptions",
    ];

    for (const table of tables) {
      try {
        await admin.from(table).delete().eq("user_id", userId);
      } catch {}
    }

    // Delete from the users sync table
    try {
      await admin.from("users").delete().eq("supabase_user_id", userId);
    } catch {}

    // Remove from Supabase Auth — this is the authoritative deletion
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Auth delete error:", deleteError);
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
