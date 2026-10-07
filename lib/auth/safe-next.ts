// Post-auth redirect guard shared by the /callback (OAuth code) and /confirm
// (emailed token) routes. `next` is user-controlled: honour only an internal
// path on this origin (one leading slash, no backslash tricks) that is not an
// auth page, so it can't become an open redirect or a login loop.

import { stripLocale } from "@/lib/i18n/navigation";

const AUTH_ROUTES = ["/login", "/signup", "/forgot-password", "/callback", "/confirm"];

/** The path (with its query) to land on, or null for "use the dashboard". */
export function safeNextPath(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return null;
  }
  try {
    const url = new URL(next, origin);
    if (url.origin !== new URL(origin).origin) return null;
    // Dot segments can normalize to a protocol-relative path
    // ("/a/..//evil.com" -> "//evil.com"), which would leave the origin on
    // the redirect. Refuse it.
    if (url.pathname.startsWith("//")) return null;
    const logical = stripLocale(url.pathname);
    if (AUTH_ROUTES.some((r) => logical === r || logical.startsWith(`${r}/`))) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

