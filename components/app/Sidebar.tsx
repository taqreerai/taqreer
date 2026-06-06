"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

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
  return (
    <div className="relative group w-full">
      <Link
        href={href}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
        className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-full relative ${
          isActive ? 'nav-active' : 'nav-item'
        }`}
      >
        <div
          className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0 nav-icon transition-colors duration-200"
          style={{ color: isActive ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
        >
          <AnimatedIcon ref={iconRef} name={icon} size={20} />
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
      <Tooltip
        isCollapsed={isCollapsed}
        text={comingSoon ? `${label} (قريباً)` : label}
      />
    </div>
  );
}

function Tooltip({ isCollapsed, text }: { isCollapsed: boolean; text: string }) {
  if (!isCollapsed) return null;
  return (
    <div className="sidebar-tooltip absolute right-full top-1/2 -translate-y-1/2 mr-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
      {text}
    </div>
  );
}

export function Sidebar({
  isCollapsed = false,
  transitionClass = "transition-all duration-300 ease-in-out",
  hidden = false,
}: {
  isCollapsed?: boolean;
  transitionClass?: string;
  // When true (distraction-free /project editing) the sidebar slides off the
  // trailing (right, in RTL) edge + fades. Transform is owned by framer; the
  // `transitionClass` below should cover only width, not transform.
  hidden?: boolean;
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
    <motion.aside
      aria-label="Sidebar"
      initial={false}
      animate={{ x: hidden ? "100%" : "0%", opacity: hidden ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      style={{ pointerEvents: hidden ? "none" : "auto" }}
      // `backdrop-blur-glass backdrop-saturate-(--glass-saturation)`
      // tracks the user's Settings → glass preset; `sidebar-bg`
      // owns the (now-transparent) tint + border color. Tailwind
      // composes backdrop-filter — raw `backdrop-filter` in the
      // class would lose to it (memory: feedback_tw_glass_system).
      className={`sidebar-bg backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed right-0 top-0 h-screen z-50 flex flex-col border-l ${transitionClass} ${
        isCollapsed ? "w-[80px]" : "w-[260px]"
      }`}
    >
      {/* ── Logo ── */}
      <div className="h-20 flex items-center px-[18px] flex-shrink-0 border-b border-white/[0.08]">
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
            className={`pw-hover-trigger absolute right-0 flex items-center justify-center w-[44px] h-[44px] transition-opacity duration-300 ${
              isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ParagraphWriteIcon mode="hover" size={30} />
          </Link>
          {/* Expanded: full logo */}
          <div className={`absolute right-0 flex items-center h-[44px] transition-opacity duration-300 ${
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

        {/* Divider */}
        <div className="divider-dark flex-shrink-0" />

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

        {/* Divider */}
        <div className="divider-dark flex-shrink-0" />

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

        {/* Divider — hidden with usage bar when collapsed */}
        <div className={`divider-dark flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'opacity-0 h-0' : ''}`} />

        {/* ── Usage Bar ── */}
        <div className={`sidebar-usage flex-shrink-0 transition-all duration-300 overflow-hidden px-[18px] ${
          isCollapsed ? 'h-0 opacity-0 py-0 border-0' : 'h-[56px] opacity-100 py-3'
        }`}>
          <div className="flex justify-between text-xs mb-1.5 font-medium text-muted">
            <span>الاستخدام</span>
            <span>3 من 30 عرضًا</span>
          </div>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: '10%' }} />
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="divider-dark flex-shrink-0" />

        {/* ── Profile Area ── */}
        <div className="flex-shrink-0 py-2">
          <button
            ref={profileBtnRef}
            onClick={handleProfileClick}
            className="flex items-center mx-[18px] w-[calc(100%-36px)] h-[56px] rounded-xl transition-colors cursor-pointer"
          >
            <div className="w-[44px] h-[44px] flex justify-center items-center flex-shrink-0">
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
                className="glass-dropdown backdrop-blur-glass backdrop-saturate-(--glass-saturation) rounded-2xl shadow-2xl p-2"
              >
                <div className="px-3 py-2">
                  <p className="font-semibold text-white text-sm truncate">{name}</p>
                  <p className="text-muted text-xs truncate">{email}</p>
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
    </motion.aside>
  );
}
