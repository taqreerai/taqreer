import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/middleware";
import { locales, defaultLocale, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { localeFromPathname, stripLocale } from "@/lib/i18n/navigation";

// Logical (locale-agnostic) route prefixes. The pathname is locale-prefixed at
// runtime (/ar/dashboard), so we match against the locale-STRIPPED path.
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

// Pick the UI locale for a bare URL: a saved cookie wins, otherwise the default
// (Arabic). We deliberately do NOT sniff Accept-Language — the product is
// Arabic-first, so anonymous/new users land on `ar` regardless of their browser
// language; switching to `en` is an explicit choice (which sets the cookie).
function pickLocale(request: NextRequest): string {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  return isLocale(cookie) ? cookie : defaultLocale;
}

function hasLocalePrefix(pathname: string): boolean {
  return locales.some(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );
}

// Validate the post-auth `next` target and guarantee a locale prefix. Anything
// off-origin / malformed falls back to the locale's dashboard.
function getSafeRedirectPath(next: string | null, origin: string, locale: string) {
  const fallback = `/${locale}/dashboard`;
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;

  try {
    const redirectUrl = new URL(next, origin);
    if (redirectUrl.origin !== origin) return fallback;
    if (!redirectUrl.pathname.startsWith("/")) return fallback;
    // Never bounce back to an auth page (e.g. `?next=/en/login`) — that just
    // re-enters this same "authed user on an auth route" branch and risks a
    // redirect loop. Send those to the dashboard fallback instead.
    const logicalNext = stripLocale(redirectUrl.pathname);
    if (authRoutes.some((r) => logicalNext === r || logicalNext.startsWith(`${r}/`))) {
      return fallback;
    }
    let path = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
    // A `next` without a locale (e.g. from an external link) → prefix it so the
    // user lands inside the active locale rather than bouncing through the gate.
    if (!hasLocalePrefix(redirectUrl.pathname)) path = `/${locale}${path}`;
    return path;
  } catch {
    return fallback;
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
  const { pathname, searchParams } = request.nextUrl;
  const origin = request.nextUrl.origin;

  // API routes flow through for session refresh but are never locale-routed;
  // file requests (icon.svg, robots.txt, sitemap.xml, images) are served as-is.
  const isApi = pathname.startsWith("/api");
  const isFile = /\.[^/]+$/.test(pathname);

  // Static files (icon.svg, robots.txt, images, …) are public and never
  // locale-routed — serve them as-is and skip the Supabase session refresh
  // below so asset requests don't pay for avoidable auth I/O. Guard with
  // `!isApi` so a dynamic API param that happens to contain a dot
  // (e.g. /api/projects/x/slides/key.png) still gets its session refresh.
  if (isFile && !isApi) {
    return NextResponse.next();
  }

  // ── Locale gate ──────────────────────────────────────────────────────────
  // Chrome direction is URL-driven, so every page URL must carry a locale.
  // Redirect bare URLs to a locale prefix before anything else. (The slide
  // canvas direction is independent — it comes from the deck, not from here.)
  if (!isApi && !isFile && !hasLocalePrefix(pathname)) {
    const locale = pickLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
    return NextResponse.redirect(url);
  }

  // ── Coming-soon gate (pre-launch) ────────────────────────────────────────
  // COMING_SOON=1 locks every page behind the coming-soon screen; visiting
  // /preview?key=<COMING_SOON_KEY> sets the unlock cookie. API routes are
  // never gated (webhooks + auth callbacks must keep working). Local dev is
  // unaffected (the env var is only set on the production server).
  if (process.env.COMING_SOON === "1" && !isApi) {
    const gateLocale = localeFromPathname(pathname) ?? defaultLocale;
    const gatePath = stripLocale(pathname);
    const unlocked = request.cookies.get("tq_preview")?.value === "1";
    if (
      gatePath === "/preview" &&
      process.env.COMING_SOON_KEY &&
      searchParams.get("key") === process.env.COMING_SOON_KEY
    ) {
      const res = NextResponse.redirect(new URL(`/${gateLocale}`, request.url));
      res.cookies.set("tq_preview", "1", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      return res;
    }
    // Legal pages stay public during coming-soon (Stripe expects reachable
    // Terms/Privacy/Refund; transparency too). Strip a trailing slash so the
    // canonical and `/terms/` forms both stay public (middleware runs before
    // Next's trailing-slash redirect).
    const normalizedGatePath =
      gatePath !== "/" ? gatePath.replace(/\/+$/, "") : gatePath;
    const alwaysPublic =
      normalizedGatePath === "/coming-soon" ||
      normalizedGatePath === "/terms" ||
      normalizedGatePath === "/privacy" ||
      normalizedGatePath === "/refund" ||
      normalizedGatePath === "/contact";
    if (!unlocked && !alwaysPublic) {
      return NextResponse.rewrite(new URL(`/${gateLocale}/coming-soon`, request.url));
    }
  }

  // Refresh the Supabase session (runs for both pages and API routes).
  const { supabase, response } = await createClient(request);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // The active locale for building redirects, and the locale-stripped path used
  // for route matching (API paths carry no locale, so match them directly).
  const locale = localeFromPathname(pathname) ?? defaultLocale;
  const logicalPath = isApi ? pathname : stripLocale(pathname);

  // Anchored route matching — `startsWith` alone would match unrelated paths
  // like `/login-help` or `/signup-banner`. Match the exact path or the route
  // followed by a `/` so only true sub-trees count (CR #42 finding, 2026-05-28).
  const matchesRoute = (route: string) =>
    logicalPath === route || logicalPath.startsWith(`${route}/`);
  const isProtectedRoute = protectedRoutes.some(matchesRoute);
  const isAuthRoute = authRoutes.some(matchesRoute);

  // Redirect unauthenticated users to login (preserving the locale + intent).
  if (isProtectedRoute && !session) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("next", pathname + (searchParams.toString() ? `?${searchParams}` : ""));
    return preserveAuthCookies(NextResponse.redirect(loginUrl), response);
  }

  // Redirect authenticated users away from auth pages.
  if (isAuthRoute && session) {
    const next = searchParams.get("next");
    const template = searchParams.get("template");
    const redirectPath = getSafeRedirectPath(next, origin, locale);
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
     * - api/extract, api/storage (file-upload routes): when a request matches
     *   the middleware, Next buffers its body to a 10MB default and truncates
     *   the rest, so a >10MB upload reaches the route as a broken multipart and
     *   request.formData() throws. These routes do their own auth and proxy.ts
     *   never reads the body for /api, so skip them entirely (no session-
     *   refresh loss that matters - the route's getUser() refreshes anyway).
     * - ingest (PostHog reverse-proxy rewrite -> eu.i.posthog.com): a pure
     *   pass-through; locale-routing it would break the analytics requests.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/extract|api/storage|ingest).*)",
  ],
};
