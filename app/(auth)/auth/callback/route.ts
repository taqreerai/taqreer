import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";
  const template = searchParams.get("template");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Sync user to database
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          const user = session.user;
          await supabase.from("users").upsert(
            {
              supabase_user_id: user.id,
              email: user.email,
              name:
                user.user_metadata?.name ||
                user.email?.split("@")[0] ||
                "User",
              avatar_url: user.user_metadata?.avatar_url || null,
              plan: "free",
              language: "ar",
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "supabase_user_id",
            }
          );
        }
      } catch (err) {
        console.error("User sync error:", err);
        // Continue even if sync fails
      }

      // Always go through the confirmation page first, then /dashboard
      return NextResponse.redirect(new URL("/auth/confirmed", request.url));
    }
  }

  // Return user to login page with error
  return NextResponse.redirect(new URL("/auth/login", request.url));
}
