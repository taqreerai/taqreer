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
import { isLocale } from "@/lib/i18n/config";

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

// PATCH /api/me — persist the signed-in user's UI language to their account
// (`User.language`). The cookie is still the per-browser fast path the proxy
// reads; this is the cross-device source of truth, seeded back into the cookie
// at login (user-sync / OAuth callback). Body: `{ locale: "ar" | "en" }`.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    return new NextResponse(null, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = typeof body?.locale === "string" ? body.locale : undefined;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }
  // `updateMany` (not `update`) so a missing row is a no-op rather than a throw
  // — the Prisma user is created lazily on first authed page load.
  await prisma.user.updateMany({
    where: { supabaseUserId: data.user.id },
    data: { language: locale },
  });
  return NextResponse.json({ ok: true });
}
