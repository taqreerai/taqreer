"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { stripLocale, localizedHref, switchLocaleHref } from "@/lib/i18n/navigation";
import { locales, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/ui-cookies";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { Tooltip } from "@/components/common/Tooltip";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";
import { AllNotificationsModal } from "@/components/app/AllNotificationsModal";
import { notificationStore, useNotifications } from "@/lib/notifications/store";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { CreditRing } from "@/components/app/CreditRing";
import { format } from "date-fns";
import { dateFnsLocale } from "@/lib/i18n/date";

// Recent-usage row helpers for the credit breakdown in the profile
// menu. A settle event's stored amount is the REFUND remainder; the
// number the user cares about is what the generation actually cost,
// which rides in metadata.charged.
type CreditEvent = {
  eventType: string;
  amount: number;
  metadata: unknown;
};

function creditEventDelta(event: CreditEvent): number {
  if (event.eventType === "credit.settle") {
    const charged = (event.metadata as { charged?: number } | null)?.charged;
    return -(typeof charged === "number" ? charged : 0);
  }
  return event.amount;
}

function creditEventLabel(
  event: CreditEvent,
  dict: ReturnType<typeof useDict>,
): string {
  const t = dict.components.credits.events;
  switch (event.eventType) {
    case "credit.settle":
      return t.generation;
    case "credit.charge": {
      const kind = (event.metadata as { kind?: string } | null)?.kind;
      return kind === "name-gen" ? t.nameGen : t.aiEdit;
    }
    case "credit.release":
      return t.refund;
    case "credit.grant.topup":
      return t.topup;
    case "credit.grant.subscription":
      return t.renewal;
    case "credit.grant.signup":
      return t.welcome;
    case "credit.reset":
      return t.reset;
    case "credit.expire_topup":
      return t.expired;
    default:
      return event.eventType;
  }
}

// One sidebar nav link. Each instance owns its own icon ref so the
// pill's mouseenter / mouseleave can drive the animated icon
// imperatively (per user direction 2026-05-28: "hover animation
// should start on button hover not icon hover"). The icons
// themselves had their own `onHoverStart` / `onHoverEnd` SVG props
// stripped — animation is parent-driven only.
function SidebarNavLink({
  href,
  icon,
  label,
  isActive,
  isCollapsed,
  comingSoon = false,
}: {
  href: string;
  icon: string;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  comingSoon?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const iconRef = useRef<AnimatedIconHandle>(null);

  // The rail is icon-only, so each link carries the shared animated tooltip with
  // its label. The pill points toward the content — left of the rail in RTL (rail
  // on the right), right of it in LTR (rail on the left). The link's own mouse
  // handlers still drive the hover icon animation.
  return (
    <Tooltip
      placement={dir === "rtl" ? "left" : "right"}
      className="relative block w-full"
      label={comingSoon ? `${label} (${dict.nav.comingSoon})` : label}
    >
      <Link
        href={href}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
        className={`flex items-center mx-[10px] w-[calc(100%-20px)] h-[40px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-full relative ${
          isActive ? 'nav-active' : 'nav-item'
        }`}
      >
        <div
          className="flex items-center justify-center w-[40px] h-[40px] flex-shrink-0 nav-icon transition-colors duration-200"
          style={{ color: isActive ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
        >
          <AnimatedIcon ref={iconRef} name={icon} size={18} />
        </div>
        <span className={`font-medium text-sm transition-all duration-300 ${
          isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
        }`}>
          {label}
        </span>
        {comingSoon && !isCollapsed && (
          <span className="ms-auto me-3 rounded-md bg-overlay px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            {dict.nav.comingSoon}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}

export function Sidebar({
  // §22: the rail is ALWAYS collapsed (no expand). The prop is kept (defaulting
  // true) so the existing collapsed-branch rendering + tooltips just work.
  isCollapsed = true,
  transitionClass = "transition-all duration-300 ease-in-out",
}: {
  isCollapsed?: boolean;
  transitionClass?: string;
}) {
  // Locale-stripped so `pathname === item.path` (unprefixed) still marks the
  // active nav item after the [lang] move (pathname is /ar/dashboard).
  const rawPathname = usePathname() ?? "";
  const pathname = stripLocale(rawPathname);
  const router = useRouter();
  const { locale, dir } = useLocale();
  const dict = useDict();
  const { user, avatarUrl, name, email } = useUser();
  const supabase = createClient();
  // Shared credit balance - the same store feeds the avatar ring here,
  // the breakdown in the profile menu below, and the settings card, so
  // all three always show one number (and tick live on broadcasts).
  const credits = useCreditBalance();
  const creditFraction =
    credits && credits.capacity > 0
      ? credits.balance.total / credits.capacity
      : null;
  const [profileOpen, setProfileOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top?: number; bottom?: number; left?: number; right?: number; width: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // §20: header chrome moved into this profile menu. These overlays are
  // opened by their menu rows below and render via their own body portals.
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Theme toggle for the profile menu (mirrors components/app/ThemeToggle): flip
  // the `.light` class on <html> + persist the `tq_theme` cookie. Synced from the
  // DOM on mount (SSR already applied the class), so the row icon matches.
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);
  // Profile menu sub-view — the language picker is a "Language >" drilldown that
  // swaps the menu body for a back header + the locale options. Reset to the main
  // view whenever the menu closes so it always reopens at the top level.
  const [langView, setLangView] = useState(false);
  useEffect(() => {
    if (!profileOpen) setLangView(false);
  }, [profileOpen]);
  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.cookie = `${THEME_COOKIE}=${next ? "light" : "dark"};path=/;max-age=31536000;samesite=lax`;
  };

  // Chrome locale switch (mirrors components/i18n/LanguageMenu): swap the locale
  // segment of the current path, persist the cookie, and best-effort save to the
  // account. Closes the menu on pick.
  const chooseLocale = (next: Locale) => {
    setProfileOpen(false);
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    void fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
    router.push(switchLocaleHref(rawPathname, next));
  };

  // Unread badge for the "الإشعارات" row + the avatar dot. Mirror the bell's
  // filter (hide premature "deck finished" rows) so the count matches what
  // the modal lists. The store boot/toasts live in the headless BellDropdown
  // mounted by DashboardShell — this only reads the shared snapshot.
  const allNotifications = useNotifications();
  const notifications = useMemo(
    () => allNotifications.filter((n) => n.type !== "deck.generate.finished"),
    [allNotifications],
  );
  const unread = notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
  // Clamped label shared by the avatar dot + the notifications menu-row badge.
  const unreadLabel = unread > 9 ? "9+" : unread;

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (!profileBtnRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setProfileOpen(false);
      }
    }
    // Match the affordance every other dropdown / popover in the
    // app supports (HistoryPopover, BellDropdown, ProjectLightbox,
    // AllNotificationsModal). Esc closes the profile menu.
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleProfileClick = () => {
    if (!profileBtnRef.current) return;
    const rect = profileBtnRef.current.getBoundingClientRect();
    // The rail sits on the inline-start side (right in RTL, left in LTR), so the
    // profile menu opens toward the content: left of the button in RTL, right of
    // it in LTR.
    if (isCollapsed) {
      setDropdownPos({
        bottom: window.innerHeight - rect.top,
        ...(dir === "rtl"
          ? { right: window.innerWidth - rect.left + 8 }
          : { left: rect.right + 8 }),
        width: 224,
      });
    } else {
      setDropdownPos({
        bottom: window.innerHeight - rect.top + 8,
        ...(dir === "rtl"
          ? { right: window.innerWidth - rect.right }
          : { left: rect.left }),
        width: rect.width,
      });
    }
    setProfileOpen((prev) => !prev);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push(localizedHref("/login", locale));
    router.refresh();
  };

  // Action buttons — `إنشاء / تحسين / محاكاة / من بيانات`.
  // The per-flow brand colours (blue/magenta/lavender/violet/cyan)
  // that used to paint the active background block were dropped
  // 2026-05-21: solid coloured blocks competed with the glass system
  // and made the sidebar read as "loud chrome" rather than the
  // canonical raised-glass active state used elsewhere. Active state
  // now reuses `.nav-active` (same recipe as the lower nav links)
  // so all sidebar items share one active vocabulary.
  //
  // 2026-05-22: "من قالب" → /templates was moved out of this group
  // and into the library group below as "القوالب", sitting next to
  // "مشاريعي". Templates are a LIBRARY artefact (a saved-state you
  // browse), not a generation flow — putting them next to projects
  // matches the user's mental model of "my stuff vs. ways to start
  // new stuff". The "create from a template" entry point will live
  // inside the template's own preview (Phase D), not as a sidebar
  // shortcut.
  const actionButtons: Array<{
    label: string;
    icon: string;
    path: string;
    comingSoon?: boolean;
  }> = [
    { label: dict.nav.create, icon: 'add_circle', path: '/create' },
    { label: dict.nav.enhance, icon: 'auto_fix_high', path: '/enhance' },
    { label: dict.nav.mimic, icon: 'content_copy', path: '/mimic' },
    { label: dict.nav.fromData, icon: 'dataset', path: '/datasheet', comingSoon: true },
  ];

  const navLinks = [
    // `/projects` takes the `folder_copy` icon (formerly /folders') —
    // projects ARE the folder metaphor at the user level; we don't
    // need a separate folders concept.
    // `/templates` lives directly below /projects so the user's two
    // library surfaces sit as a paired group. Moved here from the
    // "Create" group on 2026-05-22 — see actionButtons docstring.
    { path: '/projects', icon: 'folder_copy', label: dict.nav.projects },
    { path: '/templates', icon: 'grid_view', label: dict.nav.templates },
    { path: '/library', icon: 'photo_library', label: dict.nav.imageLibrary },
    { path: '/brand-kits', icon: 'id_card', label: dict.nav.brandKits },
    { path: '/favorites', icon: 'star', label: dict.nav.favorites },
    { path: '/settings', icon: 'settings', label: dict.nav.settings },
  ];

  return (
    <aside
      aria-label="Sidebar"
      // §22: thin transparent icon rail (always collapsed). No fill, no blur,
      // no separator border — it floats on the dark gutter as the single chrome
      // across the whole app. Labels are hidden; hover shows a tooltip.
      className={`sidebar-bg fixed start-2 top-0 h-screen z-50 flex flex-col w-[60px] ${transitionClass}`}
    >
      {/* ── Logo ── */}
      <div className="h-20 flex items-center px-[10px] flex-shrink-0">
        <div className="relative flex items-center h-full w-full">
          {/* Collapsed: icon only — wrapped in a Link to /dashboard so
              clicking the brand mark always returns home, and animated
              via `ParagraphWriteIcon` in "hover" mode so the three
              white bars sit static at rest and only play the infinite
              write-loop while the user hovers the logo button.
              `pw-hover-trigger` is the CSS hook the icon's hover-mode
              rules gate on. User direction 2026-05-28. */}
          <Link
            href={localizedHref("/dashboard", locale)}
            aria-label={dict.nav.home}
            className={`pw-hover-trigger absolute start-0 flex items-center justify-center w-[40px] h-[40px] transition-opacity duration-300 ${
              isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ParagraphWriteIcon mode="hover" size={26} />
          </Link>
          {/* Expanded: full logo */}
          <div className={`absolute start-0 flex items-center h-[40px] transition-opacity duration-300 ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}>
            <ThemeLogo width={110} height={28} className="object-contain" />
            <span className="badge-purple me-3 mt-1">{dict.common.pro}</span>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col w-full hide-scrollbar">

        {/* Home — the burger toggle that used to live here was lifted
            to the Header (single sidebar control, matched to the bell
            button's glass recipe). */}
        <div className="flex flex-col py-3 w-full">
          {/* Home */}
          <SidebarNavLink
            href={localizedHref("/dashboard", locale)}
            icon="home"
            label={dict.nav.home}
            isActive={pathname === '/dashboard'}
            isCollapsed={isCollapsed}
          />
        </div>

        {/* ── Action Buttons ──
            Active vs. idle uses the same `.nav-active` / `.nav-item`
            classes as the lower nav links so every sidebar item shares
            one active vocabulary. No per-flow background-color or
            boxShadow — see actionButtons docstring above for the
            rationale. SidebarNavLink owns the animated-icon ref so
            hovering the pill drives the animation. */}
        <div className="flex flex-col py-3 gap-1 w-full">
          {actionButtons.map((btn) => (
            <SidebarNavLink
              key={btn.path}
              href={localizedHref(btn.path, locale)}
              icon={btn.icon}
              label={btn.label}
              isActive={pathname === btn.path}
              isCollapsed={isCollapsed}
              comingSoon={btn.comingSoon}
            />
          ))}
        </div>

        {/* ── Nav Links ── */}
        <nav className="flex flex-col py-3 gap-1 flex-1 w-full">
          {navLinks.map((item) => (
            <SidebarNavLink
              key={item.path}
              href={localizedHref(item.path, locale)}
              icon={item.icon}
              label={item.label}
              isActive={pathname === item.path}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>

        {/* ── Profile Area ── (§22: usage bar + dividers removed — the rail is
            just icons on the gutter, no separators) */}
        <div className="flex-shrink-0 py-2">
          <button
            ref={profileBtnRef}
            onClick={handleProfileClick}
            className="flex items-center mx-[10px] w-[calc(100%-20px)] h-[56px] rounded-xl transition-colors cursor-pointer"
          >
            <div className="relative w-[40px] h-[40px] flex justify-center items-center flex-shrink-0">
              {/* Credit ring - at-a-glance used-vs-remaining around the
                  avatar. Same store as the menu breakdown + settings
                  card; hidden until the first balance fetch lands. */}
              {creditFraction !== null && credits ? (
                <CreditRing
                  fraction={creditFraction}
                  label={dict.components.credits.ringLabel
                    .replace("{remaining}", formatCredits(credits.balance.total))
                    .replace("{total}", formatCredits(credits.capacity))}
                />
              ) : null}
              {/* Unread-notifications badge (§20). With the header bell gone,
                  this is the only always-visible unread cue — anchored to the
                  avatar's top-start corner. Sky-blue chip, same vocabulary as
                  the old bell badge. */}
              {unread > 0 ? (
                <span className="absolute -top-0.5 end-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-foreground shadow">
                  {unreadLabel}
                </span>
              ) : null}
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={name}
                  width={36}
                  height={36}
                  // `no-referrer` for Google profile pics — without
                  // it `lh3.googleusercontent.com` 403s in incognito
                  // because the global `Referrer-Policy: origin-when-
                  // cross-origin` from next.config triggers Google's
                  // hotlink-defence path. Same fix shipped to
                  // components/common/Avatar.tsx + the Settings page.
                  referrerPolicy="no-referrer"
                  className="w-[36px] h-[36px] rounded-full object-cover tq-avatar-ring"
                />
              ) : (
                <div
                  // Per-user gradient via hash(seed) — same picker the
                  // presence avatars in SlideNavSidebar use, so the
                  // dashboard and the editor render the same person
                  // the same colour. Inline `backgroundImage` overrides
                  // the canonical single-gradient `background` set on
                  // `.tq-avatar-fallback`. Seed prefers the supabase
                  // user id (stable across sessions, matches what
                  // presence broadcasts use) and falls back to email
                  // / name so a logged-out preview render still gets
                  // a stable colour.
                  className="w-[36px] h-[36px] rounded-full tq-avatar-fallback text-sm"
                  style={{
                    backgroundImage: avatarGradientForSeed(
                      user?.id ?? email ?? name,
                    ),
                  }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-300 text-start ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100 pe-1'
            }`}>
              <span className="font-medium text-foreground text-sm leading-tight truncate">{name}</span>
              <span className="text-muted text-[11px] truncate">{email}</span>
            </div>
          </button>
        </div>

        {/* Portal dropdown — outside sidebar DOM so overflow never clips it */}
        {mounted && createPortal(
          <AnimatePresence>
            {profileOpen && dropdownPos && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  top: dropdownPos.top,
                  bottom: dropdownPos.bottom,
                  left: dropdownPos.left,
                  right: dropdownPos.right,
                  width: dropdownPos.width,
                  zIndex: 9999,
                }}
                // `.surface-menu` is background-free now (no own tint).
                // Blur comes from the Tailwind utilities so it participates
                // in v4's compositional `backdrop-filter` rule — without
                // these utilities the dropdown is completely see-through
                // (no blur), since the CSS class only sets border. See
                // globals.css `.surface-menu` for full reasoning.
                // max-height + scroll so the now-taller menu (§20: header
                // controls live here) never runs off the top of short
                // viewports — it opens upward from the bottom-anchored profile
                // button.
                role="menu"
                className="surface-menu rounded-2xl p-2 max-h-[calc(100vh-1.5rem)] overflow-y-auto hide-scrollbar"
              >
                {langView ? (
                  // ── Language sub-view (drilldown from the "Language >" row) ──
                  <>
                    <button
                      type="button"
                      onClick={() => setLangView(false)}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {dir === "rtl" ? "chevron_right" : "chevron_left"}
                      </span>
                      <span className="font-semibold">{dict.language.label}</span>
                    </button>
                    <div className="divider-dark my-1" />
                    {locales.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={code === locale}
                        onClick={() => chooseLocale(code)}
                        className="dropdown-item"
                      >
                        <span
                          className="material-symbols-outlined text-[18px]"
                          style={{ opacity: code === locale ? 1 : 0 }}
                          aria-hidden
                        >
                          check
                        </span>
                        <span>{code === "ar" ? dict.language.ar : dict.language.en}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  // ── Main view ──
                  <>
                    <div className="px-3 py-2">
                      <p className="font-semibold text-foreground text-sm truncate">{name}</p>
                      <p className="text-muted text-xs truncate">{email}</p>
                    </div>
                    <div className="divider-dark my-1" />

                    {/* ── Credit breakdown ── balance, subscription vs
                        top-up split, renewal date, recent movements.
                        Reads the SAME store as the avatar ring and the
                        settings card; updates in place on the
                        credit.balance.changed broadcast. */}
                    {credits ? (
                      <>
                        <div className="px-3 py-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted">
                              {dict.components.credits.title}
                            </span>
                            <span className="text-sm font-semibold text-foreground tabular-nums" dir="ltr">
                              {formatCredits(credits.balance.total)}
                            </span>
                          </div>
                          <div className="progress-track my-2">
                            <div
                              className="progress-bar"
                              style={{
                                width: `${Math.round((creditFraction ?? 0) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-muted">
                            <span>{dict.components.credits.subscriptionSplit}</span>
                            <span className="tabular-nums" dir="ltr">
                              {formatCredits(credits.balance.subscription)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted">
                            <span>{dict.components.credits.topupSplit}</span>
                            <span className="tabular-nums" dir="ltr">
                              {formatCredits(credits.balance.topup)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted">
                            {credits.balance.allotmentResetAt
                              ? dict.components.credits.renews.replace(
                                  "{date}",
                                  format(
                                    new Date(credits.balance.allotmentResetAt),
                                    "d MMMM",
                                    { locale: dateFnsLocale(locale) },
                                  ),
                                )
                              : dict.components.credits.noRenewal}
                          </p>
                          {credits.recent.length > 0 ? (
                            <div className="mt-2 border-t border-[var(--tq-border-hairline)] pt-1.5">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                {dict.components.credits.recentUsage}
                              </p>
                              {credits.recent.slice(0, 3).map((event) => {
                                const delta = creditEventDelta(event);
                                return (
                                  <div
                                    key={event.id}
                                    className="flex items-center justify-between py-0.5 text-[11px]"
                                  >
                                    <span className="truncate text-muted">
                                      {creditEventLabel(event, dict)}
                                    </span>
                                    <span
                                      className={`ms-2 shrink-0 tabular-nums ${
                                        delta > 0 ? "text-emerald-400" : "text-muted"
                                      }`}
                                      dir="ltr"
                                    >
                                      {delta > 0 ? "+" : ""}
                                      {formatCredits(delta)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                        <div className="divider-dark my-1" />
                      </>
                    ) : null}

                    {/* ── Header chrome, relocated (§20) ──
                        The dashboard header is hidden app-wide; its controls live
                        here as menu rows. Action rows close the menu, then open
                        their own (body-portalled) overlay. */}
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        setNewProjectOpen(true);
                      }}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">add_circle</span>
                      <span>{dict.profileMenu.newProject}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        // Match the bell's "all-read on open" rule so the badge
                        // clears the moment the list is surfaced.
                        notificationStore.markAllRead();
                        setNotificationsOpen(true);
                      }}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">notifications</span>
                      <span>{dict.profileMenu.notifications}</span>
                      {unread > 0 ? (
                        <span className="ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-foreground">
                          {unreadLabel}
                        </span>
                      ) : null}
                    </button>

                    <div className="divider-dark my-1" />

                    {/* Theme toggle — flips the chrome theme in place (menu stays
                        open so the colour change is visible). */}
                    <button
                      type="button"
                      onClick={toggleTheme}
                      aria-pressed={light}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {light ? "dark_mode" : "light_mode"}
                      </span>
                      <span>{dict.topBar.theme}</span>
                    </button>

                    {/* Language — opens the locale sub-view (drilldown). */}
                    <button
                      type="button"
                      onClick={() => setLangView(true)}
                      aria-haspopup="menu"
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">translate</span>
                      <span>{dict.language.label}</span>
                      <span className="material-symbols-outlined text-[18px] ms-auto opacity-50">
                        {dir === "rtl" ? "chevron_left" : "chevron_right"}
                      </span>
                    </button>

                    <div className="divider-dark my-1" />

                    <Link
                      href={localizedHref("/settings", locale)}
                      onClick={() => setProfileOpen(false)}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">settings</span>
                      <span>{dict.profileMenu.settings}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="dropdown-item"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      <span>{dict.profileMenu.signOut}</span>
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>

      {/* ── Header-chrome overlays, relocated (§20) ──
          Opened from the profile-menu rows above. Each renders via its own
          body portal, so its position in this tree is irrelevant. */}
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
      <AllNotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        items={notifications}
      />
    </aside>
  );
}
