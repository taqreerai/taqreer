"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { NewProjectDialog } from "@/components/app/NewProjectDialog";
import { AllNotificationsModal } from "@/components/app/AllNotificationsModal";
import { ServerStatusChip } from "@/components/app/ServerStatusChip";
import { notificationStore, useNotifications } from "@/lib/notifications/store";

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
  const iconRef = useRef<AnimatedIconHandle>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  // §24: the tooltip is PORTALLED to <body> with fixed positioning. The rail's
  // scroll container is `overflow-x-hidden`, which clipped the old in-flow
  // `right-full` tooltip so it never actually appeared — that's why the rail
  // looked like it had no tooltips. null = hidden.
  const [tipPos, setTipPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  const handleEnter = () => {
    iconRef.current?.startAnimation();
    if (!isCollapsed) return;
    const r = linkRef.current?.getBoundingClientRect();
    if (r) {
      setTipPos({
        top: r.top + r.height / 2,
        // gap from the rail (the tooltip shouldn't look glued to the icons)
        right: window.innerWidth - r.left + 14,
      });
    }
  };
  const handleLeave = () => {
    iconRef.current?.stopAnimation();
    setTipPos(null);
  };

  return (
    <div className="relative w-full">
      <Link
        ref={linkRef}
        href={href}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className={`flex items-center mx-[10px] w-[calc(100%-20px)] h-[40px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-full relative ${
          isActive ? 'nav-active' : 'nav-item'
        }`}
      >
        <div
          className="flex items-center justify-center w-[40px] h-[40px] flex-shrink-0 nav-icon transition-colors duration-200"
          style={{ color: isActive ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
        >
          <AnimatedIcon ref={iconRef} name={icon} size={16} />
        </div>
        <span className={`font-medium text-sm transition-all duration-300 ${
          isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
        }`}>
          {label}
        </span>
        {comingSoon && !isCollapsed && (
          <span className="ml-auto mr-3 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            قريباً
          </span>
        )}
      </Link>
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {tipPos ? (
                <motion.div
                  key="sidebar-tip"
                  className="sidebar-tooltip pointer-events-none fixed z-[9999]"
                  style={{ top: tipPos.top, right: tipPos.right }}
                  // Slide in right→left (emerges from the rail toward content).
                  initial={{ opacity: 0, x: 10, y: "-50%" }}
                  animate={{ opacity: 1, x: 0, y: "-50%" }}
                  exit={{ opacity: 0, x: 10, y: "-50%" }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {comingSoon ? `${label} (قريباً)` : label}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
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
  const pathname = usePathname();
  const router = useRouter();
  const { user, avatarUrl, name, email } = useUser();
  const supabase = createClient();
  const [profileOpen, setProfileOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top?: number; bottom?: number; right: number; width: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // §20: header chrome moved into this profile menu. These overlays are
  // opened by their menu rows below and render via their own body portals.
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

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
    if (isCollapsed) {
      setDropdownPos({
        bottom: window.innerHeight - rect.top,
        right: window.innerWidth - rect.left + 8,
        width: 224,
      });
    } else {
      setDropdownPos({
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right,
        width: rect.width,
      });
    }
    setProfileOpen((prev) => !prev);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
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
    { label: 'إنشاء', icon: 'add_circle', path: '/create' },
    { label: 'تحسين', icon: 'auto_fix_high', path: '/enhance' },
    { label: 'محاكاة', icon: 'content_copy', path: '/mimic' },
    { label: 'من بيانات', icon: 'dataset', path: '/datasheet', comingSoon: true },
  ];

  const navLinks = [
    // `/projects` takes the `folder_copy` icon (formerly /folders') —
    // projects ARE the folder metaphor at the user level; we don't
    // need a separate folders concept.
    // `/templates` lives directly below /projects so the user's two
    // library surfaces sit as a paired group. Moved here from the
    // "Create" group on 2026-05-22 — see actionButtons docstring.
    { path: '/projects', icon: 'folder_copy', label: 'مشاريعي' },
    { path: '/templates', icon: 'grid_view', label: 'القوالب' },
    { path: '/library', icon: 'photo_library', label: 'مكتبة الصور' },
    { path: '/brand-kits', icon: 'id_card', label: 'هوية الشركة' },
    { path: '/favorites', icon: 'star', label: 'المفضلة' },
    { path: '/settings', icon: 'settings', label: 'الإعدادات' },
  ];

  return (
    <aside
      aria-label="Sidebar"
      // §22: thin transparent icon rail (always collapsed). No fill, no blur,
      // no separator border — it floats on the dark gutter as the single chrome
      // across the whole app. Labels are hidden; hover shows a tooltip.
      className={`sidebar-bg fixed right-2 top-0 h-screen z-50 flex flex-col w-[60px] ${transitionClass}`}
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
            href="/dashboard"
            aria-label="الرئيسية"
            className={`pw-hover-trigger absolute right-0 flex items-center justify-center w-[40px] h-[40px] transition-opacity duration-300 ${
              isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ParagraphWriteIcon mode="hover" size={26} />
          </Link>
          {/* Expanded: full logo */}
          <div className={`absolute right-0 flex items-center h-[40px] transition-opacity duration-300 ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}>
            <Image src="/logo-light.svg" alt="Taqreer Logo" width={110} height={28} className="object-contain" />
            <span className="badge-purple mr-3 mt-1">احترافي</span>
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
            href="/dashboard"
            icon="home"
            label="الرئيسية"
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
              href={btn.path}
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
              href={item.path}
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
              {/* Unread-notifications badge (§20). With the header bell gone,
                  this is the only always-visible unread cue — anchored to the
                  avatar's top-start corner. Sky-blue chip, same vocabulary as
                  the old bell badge. */}
              {unread > 0 ? (
                <span className="absolute -top-0.5 right-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow">
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
            <div className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-300 text-right ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100 pr-1'
            }`}>
              <span className="font-medium text-white text-sm leading-tight truncate">{name}</span>
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
                  right: dropdownPos.right,
                  width: dropdownPos.width,
                  zIndex: 9999,
                }}
                // `.glass-dropdown` is background-free now (no own tint).
                // Blur comes from the Tailwind utilities so it participates
                // in v4's compositional `backdrop-filter` rule — without
                // these utilities the dropdown is completely see-through
                // (no blur), since the CSS class only sets border. See
                // globals.css `.glass-dropdown` for full reasoning.
                // max-height + scroll so the now-taller menu (§20: header
                // controls live here) never runs off the top of short
                // viewports — it opens upward from the bottom-anchored profile
                // button.
                className="glass-dropdown backdrop-blur-glass backdrop-saturate-(--glass-saturation) rounded-2xl shadow-2xl p-2 max-h-[calc(100vh-1.5rem)] overflow-y-auto hide-scrollbar"
              >
                <div className="px-3 py-2">
                  <p className="font-semibold text-white text-sm truncate">{name}</p>
                  <p className="text-muted text-xs truncate">{email}</p>
                </div>
                <div className="divider-dark my-1" />

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
                  <span>مشروع جديد</span>
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
                  <span>الإشعارات</span>
                  {unread > 0 ? (
                    <span className="ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white">
                      {unreadLabel}
                    </span>
                  ) : null}
                </button>

                <div className="divider-dark my-1" />

                {/* Server status — display only (non-interactive). The inline
                    chip's label IS the status ("كل الأنظمة تعمل" / "أداء منخفض
                    حالياً" / …), so it doubles as the row label; it renders
                    nothing while the status is unknown/loading. */}
                <div className="dropdown-item cursor-default hover:bg-transparent! hover:text-[var(--tq-text-muted)]!">
                  <span className="material-symbols-outlined text-[18px]">monitor_heart</span>
                  <ServerStatusChip inline />
                </div>

                <div className="divider-dark my-1" />

                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="dropdown-item"
                >
                  <span className="material-symbols-outlined text-[18px]">settings</span>
                  <span>الإعدادات</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="dropdown-item"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  <span>تسجيل الخروج</span>
                </button>
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
