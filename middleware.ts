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

const authRoutes = ["/auth/login", "/auth/signup", "/auth/forgot-password"];

export async function middleware(request: NextRequest) {
  const { supabase, response } = await createClient(request);
  const { pathname, searchParams } = request.nextUrl;

  // Get session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !session) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname + (searchParams.toString() ? `?${searchParams}` : ""));
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && session) {
    const next = searchParams.get("next");
    const template = searchParams.get("template");
    const redirectPath = next || "/dashboard";
    const redirectUrl = new URL(redirectPath, request.url);
    if (template && !next) {
      redirectUrl.searchParams.set("template", template);
    }
    return NextResponse.redirect(redirectUrl);
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
