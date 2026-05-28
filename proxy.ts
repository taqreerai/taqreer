import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/middleware";

const protectedRoutes = [
  "/dashboard",
  "/projects",
  "/editor",
  "/create",
  "/enhance",
  "/settings",
  "/brand-kits",
  "/folders",
];

const authRoutes = ["/login", "/signup", "/forgot-password"];

function getSafeRedirectPath(next: string | null, origin: string) {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";

  try {
    const redirectUrl = new URL(next, origin);
    if (redirectUrl.origin !== origin) return "/dashboard";
    if (!redirectUrl.pathname.startsWith("/")) return "/dashboard";
    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return "/dashboard";
  }
}

function preserveAuthCookies(targetResponse: NextResponse, sourceResponse: NextResponse) {
  const sourceHeaders = sourceResponse.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = sourceHeaders.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    targetResponse.headers.append("set-cookie", cookie);
  }

  const setCookie = setCookies.length === 0 ? sourceResponse.headers.get("set-cookie") : null;
  if (setCookie) {
    targetResponse.headers.append("set-cookie", setCookie);
  }
  return targetResponse;
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = await createClient(request);
  const { pathname, searchParams } = request.nextUrl;
  const origin = request.nextUrl.origin;

  // Removed 2026-05-28: the localhost/dev rewrite `/` →
  // `/preview?key=taqreer2025` was wired when the full landing
  // lived behind a key-gate at /preview. Now `app/page.tsx` IS
  // the public landing, so `/` should render it directly without
  // any rewrite.

  // Get session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Anchored route matching — `startsWith` alone would match
  // unrelated paths like `/login-help` or `/signup-banner` and
  // (a) treat them as protected when they're not, (b) bounce
  // authenticated users away from them as if they were auth pages.
  // Match either the exact pathname or the route followed by a `/`
  // so only true sub-trees count (CR #42 finding, 2026-05-28).
  const matchesRoute = (route: string) =>
    pathname === route || pathname.startsWith(`${route}/`);
  const isProtectedRoute = protectedRoutes.some(matchesRoute);
  const isAuthRoute = authRoutes.some(matchesRoute);

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + (searchParams.toString() ? `?${searchParams}` : ""));
    return preserveAuthCookies(NextResponse.redirect(loginUrl), response);
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && session) {
    const next = searchParams.get("next");
    const template = searchParams.get("template");
    const redirectPath = getSafeRedirectPath(next, origin);
    const redirectUrl = new URL(redirectPath, request.url);
    if (template && !next) {
      redirectUrl.searchParams.set("template", template);
    }
    return preserveAuthCookies(NextResponse.redirect(redirectUrl), response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
