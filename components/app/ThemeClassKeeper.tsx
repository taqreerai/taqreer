"use client";

// Keeps the theme class on <html> after client navigations. The layout's
// pre-paint script only runs on a full load; a language switch re-renders
// <html> (the locale is part of the root layout) and drops `light`. A layout
// effect re-applies the stored theme after every navigation, before paint, so
// there is no dark flash (lib/theme.ts applyStoredTheme). Renders nothing.

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { applyStoredTheme } from "@/lib/theme";

export function ThemeClassKeeper() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    applyStoredTheme(pathname ?? window.location.pathname);
  }, [pathname]);
  return null;
}
