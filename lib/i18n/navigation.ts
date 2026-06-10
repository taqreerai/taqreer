// Locale-aware navigation helpers. Internal app paths carry the active locale as
// their first segment (/ar/dashboard, /en/dashboard). These keep links on the
// CURRENT locale instead of bouncing through the proxy (which would reset to the
// cookie/default locale and so could silently flip an /en session back to /ar).
//
// Client-safe (no server-only imports) so client components can use them too.
import { isLocale, type Locale } from "./config";

// Prefix an app-internal path with the locale segment. Pass-through for external
// URLs, protocol-relative, mailto/tel, and bare hashes; "/" → "/{locale}"; an
// already-localized path is returned unchanged.
export function localizedHref(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const firstSeg = href.split(/[/?#]/)[1];
  if (isLocale(firstSeg)) return href; // already localized
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

// Strip a leading locale segment from a pathname → the locale-agnostic path
// ("/ar/projects" → "/projects", "/en" → "/"). Used by the switcher to find the
// path to re-localize, and anywhere we compare against unprefixed route constants.
export function stripLocale(pathname: string): string {
  const firstSeg = pathname.split("/")[1];
  if (isLocale(firstSeg)) {
    const rest = pathname.slice(firstSeg.length + 1);
    return rest || "/";
  }
  return pathname;
}

// Read the active locale out of a pathname, or null if it carries none.
export function localeFromPathname(pathname: string): Locale | null {
  const firstSeg = pathname.split("/")[1];
  return isLocale(firstSeg) ? firstSeg : null;
}

// Swap the locale on the current pathname, preserving the rest of the path — the
// language switcher's core move ("stay on this page, just flip the language").
export function switchLocaleHref(pathname: string, next: Locale): string {
  return localizedHref(stripLocale(pathname), next);
}
