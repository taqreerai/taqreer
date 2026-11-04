"use client";

// Admin console tab nav. English-only, LTR (the whole console is forced
// dir="ltr" in the admin layout). Router-driven active state. Pill-segmented
// control styled with the app's verified design tokens via inline CSS vars
// (the same inline-token pattern the Sidebar uses for nav state).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { stripLocale, localizedHref } from "@/lib/i18n/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";

const TABS = [
  { path: "/admin", label: "Overview", icon: "dashboard" },
  { path: "/admin/templates", label: "Templates", icon: "grid_view" },
  { path: "/admin/users", label: "Users", icon: "group" },
  { path: "/admin/activity", label: "Activity", icon: "timeline" },
  { path: "/admin/decks", label: "Decks", icon: "slideshow" },
  { path: "/admin/compare", label: "Compare", icon: "compare" },
  { path: "/admin/broadcast", label: "Broadcast", icon: "campaign" },
  { path: "/admin/settings", label: "Settings", icon: "tune" },
] as const;

export function AdminTabs() {
  const { locale } = useLocale();
  const pathname = stripLocale(usePathname() ?? "");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // On mobile the 7-tab pill is wider than the viewport, so the row scrolls.
  // Keep the active tab centered on navigation, and flag which side still has
  // hidden tabs (drives the edge-fade hint, `.admin-tab-scroller` in
  // globals.css). The row fits on desktop, so both resolve to no-ops there.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const active = activeRef.current;
    if (active) {
      const target =
        active.offsetLeft - (scroller.clientWidth - active.clientWidth) / 2;
      scroller.scrollTo({ left: Math.max(0, target) });
    }
    const updateFade = () => {
      const { scrollLeft, scrollWidth, clientWidth } = scroller;
      scroller.dataset.fade =
        scrollWidth <= clientWidth + 1
          ? "none"
          : scrollLeft <= 1
            ? "right"
            : scrollLeft >= scrollWidth - clientWidth - 1
              ? "left"
              : "both";
    };
    updateFade();
    scroller.addEventListener("scroll", updateFade, { passive: true });
    window.addEventListener("resize", updateFade);
    return () => {
      scroller.removeEventListener("scroll", updateFade);
      window.removeEventListener("resize", updateFade);
    };
  }, [pathname]);

  return (
    <div
      ref={scrollerRef}
      className="admin-tab-scroller hide-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <nav className="surface-card inline-flex w-max items-center gap-1 rounded-full p-1">
        {TABS.map((tab) => {
          const active =
            tab.path === "/admin"
              ? pathname === "/admin"
              : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <Link
              key={tab.path}
              ref={active ? activeRef : undefined}
              href={localizedHref(tab.path, locale)}
              className="flex flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: active
                  ? "var(--tq-text-primary)"
                  : "var(--tq-text-muted)",
                background: active ? "var(--tq-overlay)" : "transparent",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
