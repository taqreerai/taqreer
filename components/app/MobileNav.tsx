"use client";

// Mobile navigation — the phone/tablet replacement for the desktop rail
// (Sidebar), which is `hidden md:flex`. Renders a hamburger trigger that leads
// the TopUtilityBar's start cluster (passed via its `leading` slot) plus an
// off-canvas drawer portalled to <body>. The drawer mirrors the rail 1:1: Home,
// the creation flows, the library links, the (server-gated) Admin entry, and the
// shared ProfileMenuContent for account actions (theme, language, billing, sign
// out) so nothing on the rail becomes unreachable on a small screen.
//
// Only mounts inside the dashboard shell (not the studio, which keeps its own
// chrome) — DashboardShell passes it as TopUtilityBar's `leading`.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { stripLocale, localizedHref } from "@/lib/i18n/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useAppNav, type AppNavItem } from "@/components/app/useAppNav";
import { useCreditBalance } from "@/lib/credits/store";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { ProfileMenuContent } from "@/components/app/ProfileMenuContent";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";

// Module-level so it isn't re-created each render (which would remount every row
// and drop focus/animation). One drawer nav link.
function DrawerNavRow({
  href,
  icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-12 items-center gap-3 rounded-xl px-3 ${
        active ? "nav-active" : "nav-item"
      }`}
    >
      <span
        className="material-symbols-outlined text-[20px]"
        style={{ color: active ? "var(--tq-text-primary)" : "var(--tq-muted)" }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

export function MobileNav({ isAdmin }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { locale, dir } = useLocale();
  const dict = useDict();
  const { actionButtons, navLinks } = useAppNav();
  // Admin entry: the dashboard passes the server-resolved value; the studio
  // (which doesn't resolve it) omits the prop, so fall back to the client credit
  // store, which carries isAdmin app-wide (same source the PlanBadge uses).
  const credits = useCreditBalance();
  const showAdmin = isAdmin ?? Boolean(credits?.isAdmin);
  const rawPathname = usePathname() ?? "";
  const pathname = stripLocale(rawPathname);

  // Every nav row + profile-menu link calls closeDrawer on tap, so navigation
  // always dismisses the drawer without a route-change effect (which would trip
  // the set-state-in-effect rule).

  // While open: Esc closes, and background scroll is locked (restored on close).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const isActive = (path: string) =>
    path === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === path || pathname.startsWith(`${path}/`);

  const closeDrawer = () => setOpen(false);
  const menuLabel = dict.nav.menu;
  const closeLabel = dict.common.close;

  const homeItem: AppNavItem = {
    path: "/dashboard",
    icon: "home",
    label: dict.nav.home,
  };

  return (
    <>
      {/* Hamburger — mobile only; leads the top bar's start cluster. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={menuLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        className="icon-hover flex h-9 w-9 items-center justify-center rounded-lg md:hidden"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open ? (
              <>
                <motion.div
                  key="mobile-nav-dim"
                  onClick={closeDrawer}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="modal-dim fixed inset-0 z-[1060] md:hidden"
                />
                <motion.aside
                  key="mobile-nav-drawer"
                  dir={dir}
                  aria-label={menuLabel}
                  initial={{ x: dir === "rtl" ? "100%" : "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: dir === "rtl" ? "100%" : "-100%" }}
                  transition={{ type: "spring", stiffness: 500, damping: 44 }}
                  // z above the studio bottom toolbox (z-[1050]) so the open
                  // drawer covers it; still below top-bar dropdowns/modals.
                  className="surface-menu fixed inset-y-0 start-0 z-[1061] flex w-[86vw] max-w-[320px] flex-col md:hidden"
                >
                  {/* Header — brand + close. */}
                  <div className="flex h-16 flex-shrink-0 items-center justify-between px-4">
                    <Link
                      href={localizedHref("/dashboard", locale)}
                      onClick={closeDrawer}
                      aria-label={dict.nav.home}
                      className="flex items-center"
                    >
                      <ThemeLogo width={110} height={28} className="object-contain" />
                    </Link>
                    <button
                      type="button"
                      onClick={closeDrawer}
                      aria-label={closeLabel}
                      className="icon-hover flex h-9 w-9 items-center justify-center rounded-lg"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden>
                        close
                      </span>
                    </button>
                  </div>

                  {/* Scrollable nav + account body. */}
                  <div className="hide-scrollbar flex-1 overflow-y-auto px-3 pb-6">
                    <div className="flex flex-col gap-1">
                      <DrawerNavRow
                        href={localizedHref(homeItem.path, locale)}
                        icon={homeItem.icon}
                        label={homeItem.label}
                        active={isActive(homeItem.path)}
                        onNavigate={closeDrawer}
                      />
                    </div>

                    <div className="divider-dark my-2" />

                    <div className="flex flex-col gap-1">
                      {actionButtons.map((b) => (
                        <DrawerNavRow
                          key={b.path}
                          href={localizedHref(b.path, locale)}
                          icon={b.icon}
                          label={b.label}
                          active={isActive(b.path)}
                          onNavigate={closeDrawer}
                        />
                      ))}
                    </div>

                    <div className="divider-dark my-2" />

                    <div className="flex flex-col gap-1">
                      {navLinks.map((l) => (
                        <DrawerNavRow
                          key={l.path}
                          href={localizedHref(l.path, locale)}
                          icon={l.icon}
                          label={l.label}
                          active={isActive(l.path)}
                          onNavigate={closeDrawer}
                        />
                      ))}
                      {showAdmin ? (
                        <DrawerNavRow
                          href={localizedHref("/admin", locale)}
                          icon="shield_person"
                          label={dict.common.admin}
                          active={isActive("/admin")}
                          onNavigate={closeDrawer}
                        />
                      ) : null}
                    </div>

                    <div className="divider-dark my-2" />

                    {/* Account actions — the same body as the desktop profile
                        popover (name/tier/credits, theme, language, billing,
                        sign out). Keeps everything reachable without the rail. */}
                    <ProfileMenuContent
                      onClose={closeDrawer}
                      onNewProject={() => setNewProjectOpen(true)}
                    />
                  </div>
                </motion.aside>
              </>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
    </>
  );
}
