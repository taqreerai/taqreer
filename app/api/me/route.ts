// GET /api/me
//
// Returns minimal identity info for the signed-in user — currently
// just the Prisma user id, which client-side code needs to topic
// per-user Supabase channels (the user channel is keyed on Prisma id
// to match the foreign-key shape of Notification.recipientUserId).
// Supabase auth id alone isn't enough.
//
// Why a dedicated endpoint vs. piggybacking on an existing one?
// The bell is on every page and needs this on mount; embedding it
// in /api/notifications would mean every page paying the
// notifications query just to bootstrap the channel topic.
//
// Returns 204 No Content when unauthenticated — callers treat that
// as "no user, no channel" without parsing an error body.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    return new NextResponse(null, { status: 204 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: data.user.id },
    select: { id: true },
  });
  return NextResponse.json({
    supabaseUserId: data.user.id,
    prismaUserId: dbUser?.id ?? null,
  });
}
