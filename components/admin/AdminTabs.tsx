"use client";

// Admin console tab nav. English-only, LTR (the whole console is forced
// dir="ltr" in the admin layout). Router-driven active state. Pill-segmented
// control styled with the app's verified design tokens via inline CSS vars
// (the same inline-token pattern the Sidebar uses for nav state).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stripLocale, localizedHref } from "@/lib/i18n/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";

const TABS = [
  { path: "/admin", label: "Overview", icon: "dashboard" },
  { path: "/admin/templates", label: "Templates", icon: "grid_view" },
  { path: "/admin/users", label: "Users", icon: "group" },
  { path: "/admin/broadcast", label: "Broadcast", icon: "campaign" },
  { path: "/admin/settings", label: "Settings", icon: "tune" },
] as const;

export function AdminTabs() {
  const { locale } = useLocale();
  const pathname = stripLocale(usePathname() ?? "");

  return (
    <nav className="surface-card inline-flex items-center gap-1 rounded-full p-1">
      {TABS.map((tab) => {
        const active =
          tab.path === "/admin"
            ? pathname === "/admin"
            : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
        return (
          <Link
            key={tab.path}
            href={localizedHref(tab.path, locale)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: active ? "var(--tq-text-primary)" : "var(--tq-text-muted)",
              background: active ? "var(--tq-overlay)" : "transparent",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {tab.icon}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
