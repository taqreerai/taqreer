"use client";

// Single source of truth for the app's primary navigation model, shared by the
// desktop rail (Sidebar) and the mobile drawer (MobileNav) so the two never
// drift. Home + Admin stay component-level (Home renders standalone at the top;
// Admin is server-gated and appended conditionally) — this hook owns only the
// two repeating groups: the creation flows and the library nav links.
//
// `icon` values are Material Symbols names. The rail feeds them to AnimatedIcon
// (hover-animated) and the drawer renders them as static glyphs; both accept the
// same names.

import { useDict } from "@/components/i18n/LocaleProvider";

export type AppNavItem = {
  label: string;
  icon: string;
  path: string;
  comingSoon?: boolean;
};

export function useAppNav(): {
  actionButtons: AppNavItem[];
  navLinks: AppNavItem[];
} {
  const dict = useDict();

  // Creation flows — إنشاء / تحسين / محاكاة / من بيانات.
  const actionButtons: AppNavItem[] = [
    { label: dict.nav.create, icon: "add_circle", path: "/create" },
    { label: dict.nav.enhance, icon: "auto_fix_high", path: "/enhance" },
    { label: dict.nav.mimic, icon: "content_copy", path: "/mimic" },
    { label: dict.nav.fromData, icon: "dataset", path: "/datasheet" },
  ];

  // Library surfaces — the user's saved stuff.
  const navLinks: AppNavItem[] = [
    { path: "/projects", icon: "folder_copy", label: dict.nav.projects },
    { path: "/templates", icon: "grid_view", label: dict.nav.templates },
    { path: "/library", icon: "photo_library", label: dict.nav.imageLibrary },
    { path: "/brand-kits", icon: "id_card", label: dict.nav.brandKits },
    { path: "/favorites", icon: "star", label: dict.nav.favorites },
    { path: "/settings", icon: "settings", label: dict.nav.settings },
  ];

  return { actionButtons, navLinks };
}
