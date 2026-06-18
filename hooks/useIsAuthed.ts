"use client";

import { useSyncExternalStore } from "react";

// Lightweight "is someone logged in?" check for the PUBLIC marketing/legal
// pages. It reads the Supabase auth cookie's PRESENCE from document.cookie
// instead of importing the Supabase browser client (useUser), which pulls
// ~200 KB of @supabase/supabase-js into the static marketing bundle. The
// marketing nav / pricing / template grid only need the boolean (authed vs
// anon), never the user object, so this is a drop-in replacement that keeps
// those pages light.
//
// Cookie name is `sb-<project-ref>-auth-token` (optionally chunked with
// `.0`/`.1` suffixes); @supabase/ssr's browser client stores it non-httpOnly
// so it is readable here. A stale/expired cookie can briefly read as authed —
// harmless, since the (app) layout still re-validates server-side on click.
// useSyncExternalStore keeps it hydration-safe: server snapshot is always
// false (matches the static HTML), the client reads the cookie after mount.

const AUTH_COOKIE = /(?:^|;\s*)sb-[a-z0-9-]+-auth-token/i;

function subscribe(onChange: () => void) {
  // Re-evaluate when the tab regains focus or another tab logs in/out.
  window.addEventListener("focus", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  return AUTH_COOKIE.test(document.cookie);
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsAuthed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
