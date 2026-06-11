import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { maybeGrantSignupCredits } from "@/lib/credits/signup";

export async function POST(request: Request) {
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

    // Detect first-ever sync BEFORE the upsert so the one-time signup
    // grant fires exactly when the row is born.
    const existing = await prisma.user.findUnique({
      where: { supabaseUserId: user.id },
      select: { id: true },
    });

    // `language` is intentionally NOT in `update` — a returning user keeps
    // their saved choice; a brand-new row takes the column default ("ar").
    const dbUser = await prisma.user.upsert({
      where: { supabaseUserId: user.id },
      update: profile,
      create: {
        supabaseUserId: user.id,
        ...profile,
        plan: "free",
      },
      select: { id: true, language: true },
    });

    // One-time Free signup grant (billing plan Phase A). Guarded by
    // signupGrantedAt server-side (idempotent even if two first syncs
    // race) plus the email-alias + IP-velocity abuse checks. Never
    // fails the sync - a blocked/failed grant just leaves 0 credits.
    if (!existing) {
      await maybeGrantSignupCredits({
        userId: dbUser.id,
        email: profile.email,
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null,
      }).catch((err) => {
        console.error(
          "[user-sync] signup grant failed:",
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    // Seed the locale cookie from the account language so a login on a NEW
    // browser/device lands in the user's saved language (the proxy reads only
    // the cookie — it can't reach Prisma at the edge).
    const res = NextResponse.json({ ok: true });
    if (isLocale(dbUser.language)) {
      res.cookies.set(LOCALE_COOKIE, dbUser.language, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }
    return res;
  } catch (err) {
    // Log only the message to avoid surfacing PII (Supabase user object,
    // email, headers) into server logs. The stack trace stays on the Error
    // instance for the runtime's own error tracking; we just don't print
    // the whole `err` shape.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[user-sync] failed:", message);
    return NextResponse.json({ error: "User sync failed" }, { status: 500 });
  }
}
