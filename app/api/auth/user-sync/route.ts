import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = session.user;

    // Upsert user into PostgreSQL users table
    const { error } = await supabase
      .from("users")
      .upsert(
        {
          supabase_user_id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email?.split("@")[0] || "User",
          avatar_url: user.user_metadata?.avatar_url || null,
          plan: "free",
          language: "ar",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "supabase_user_id",
        }
      );

    if (error) {
      console.error("User sync error:", error);
      return NextResponse.json(
        { error: "Failed to sync user" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("User sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
