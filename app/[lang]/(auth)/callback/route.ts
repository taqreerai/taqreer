import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { isLocale, defaultLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { siteOrigin } from "@/lib/api/site-origin";
import { stripLocale } from "@/lib/i18n/navigation";

const AUTH_ROUTES = ["/login", "/signup", "/forgot-password", "/callback", "/confirm"];

// `next` is user-controlled: honour only an internal path on this origin
// (one leading slash, no backslash tricks) that is not an auth page, so it
// can't become an open redirect or a login loop. Returns the path (with its
// query) or null for "use the dashboard". Added 2026-10-06: the open /create
// page sends visitors through sign-up with next=/<lang>/create?resume=...,
// and until now this handler always went to the dashboard.
function safeNextPath(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return null;
  }
  try {
    const url = new URL(next, origin);
    if (url.origin !== new URL(origin).origin) return null;
    // Dot segments can normalize to a protocol-relative path
    // ("/a/..//evil.com" -> "//evil.com"), which would leave the origin on
    // the redirect below. Refuse it.
    if (url.pathname.startsWith("//")) return null;
    const logical = stripLocale(url.pathname);
    if (AUTH_ROUTES.some((r) => logical === r || logical.startsWith(`${r}/`))) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Redirects MUST be based on the external origin, NOT request.url - in a route
  // handler on prod request.url is the internal http://localhost:3100 (next
  // start port behind nginx), which the browser can't reach. See site-origin.
  const origin = siteOrigin(request);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Saved account language → seeds the locale cookie + landing locale so an
      // OAuth login on a NEW device opens in the user's language. Returning
      // users have a Prisma row; brand-new OAuth users don't yet (the dashboard
      // page upserts it on first render) → fall back to the default locale.
      let locale: string = defaultLocale;
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
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "supabase_user_id",
            }
          );
          const dbUser = await prisma.user.findUnique({
            where: { supabaseUserId: user.id },
            select: { language: true },
          });
          if (isLocale(dbUser?.language)) locale = dbUser.language;
        }
      } catch (err) {
        console.error("User sync error:", err);
        // Continue even if sync fails
      }

      // Redirect straight to the (localized) dashboard. The `/confirmed`
      // interstitial was removed 2026-05-28 — it served only as a 2.5 s
      // checkmark + redirect, which added a noticeable pause without conveying
      // anything the dashboard's own load state doesn't already.
      // Back to where the auth started (e.g. /create's guest sign-up), when
      // that is a safe internal path; the dashboard otherwise.
      const nextPath = safeNextPath(searchParams.get("next"), origin);
      const nextLocale = nextPath?.split(/[/?#]/)[1];
      if (nextPath && isLocale(nextLocale)) locale = nextLocale;
      const res = NextResponse.redirect(
        new URL(nextPath ?? `/${locale}/dashboard`, origin),
      );
      res.cookies.set(LOCALE_COOKIE, locale, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
      return res;
    }
  }

  // Return user to login page with error
  return NextResponse.redirect(new URL(`/${defaultLocale}/login`, origin));
}
