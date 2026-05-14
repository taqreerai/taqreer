import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = {
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
    };

    await prisma.user.upsert({
      where: { supabaseUserId: user.id },
      update: profile,
      create: {
        supabaseUserId: user.id,
        ...profile,
        plan: "free",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[user-sync] failed:", err);
    return NextResponse.json({ error: "User sync failed" }, { status: 500 });
  }
}
