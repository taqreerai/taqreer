"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";

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
  toggleSidebar,
  transitionClass = "transition-all duration-300 ease-in-out"
}: {
  isCollapsed?: boolean;
  toggleSidebar?: () => void;
  transitionClass?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { avatarUrl, name, email } = useUser();
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
    router.push("/auth/login");
    router.refresh();
  };

  const actionButtons: Array<{
    label: string;
    icon: string;
    color: string;
    glow: string;
    path: string;
    comingSoon?: boolean;
  }> = [
    // Brand palette + glow alphas, sourced from the design-system
    // tokens (--tq-blue / --tq-magenta / --tq-lavender / --tq-violet)
    // and their *-rgb companions where defined. The data-deck cyan
    // doesn't have a token yet — flagged inline. When that flow
    // un-stubs, add `--tq-cyan` to globals.css and route the entry
    // through it.
    { label: 'إنشاء', icon: 'add_circle', color: 'var(--tq-blue)', glow: 'rgba(var(--tq-blue-rgb), 0.4)', path: '/create' },
    { label: 'تحسين', icon: 'auto_fix_high', color: 'var(--tq-magenta)', glow: 'rgba(var(--tq-magenta-rgb), 0.4)', path: '/enhance' },
    { label: 'محاكاة', icon: 'content_copy', color: 'var(--tq-lavender)', glow: 'rgba(147,38,201,0.4)', path: '/mimic' },
    { label: 'من قالب', icon: 'grid_view', color: 'var(--tq-violet)', glow: 'rgba(var(--tq-violet-rgb), 0.4)', path: '/templates' },
    // Data-deck entry uses a cyan accent — no design-system token
    // yet. Inline hex flagged for follow-up when the flow ships.
    { label: 'من بيانات', icon: 'dataset', color: '#36B8E0', glow: 'rgba(54,184,224,0.4)', path: '/datasheet', comingSoon: true },
  ];

  const navLinks = [
    { path: '/projects', icon: 'folder_managed', label: 'مشاريعي' },
    { path: '/templates', icon: 'grid_view', label: 'القوالب' },
    { path: '/brand-kits', icon: 'id_card', label: 'هوية الشركة' },
    { path: '/folders', icon: 'folder_copy', label: 'المجلدات' },
    { path: '/features', icon: 'stars', label: 'المميزات' },
    { path: '/settings', icon: 'settings', label: 'الإعدادات' },
  ];

  const iconClass = "material-symbols-outlined text-[20px] flex-shrink-0";

  return (
    <aside
      aria-label="Sidebar"
      className={`sidebar-bg fixed right-0 top-0 h-screen z-50 flex flex-col border-l ${transitionClass} ${
        isCollapsed ? "w-[80px]" : "w-[260px]"
      }`}
    >
      {/* ── Logo ── */}
      <div className="h-20 flex items-center px-[18px] flex-shrink-0 border-b border-white/[0.08]">
        <div className="relative flex items-center h-full w-full">
          {/* Collapsed: icon only */}
          <div className={`absolute right-0 flex items-center justify-center w-[44px] h-[44px] transition-opacity duration-300 ${
            isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}>
            <Image src="/icon-colored.svg" alt="Taqreer Icon" width={22} height={22} className="object-contain" />
          </div>
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

        {/* Burger + Home */}
        <div className="flex flex-col py-3 w-full">
          {/* Burger */}
          <button
            onClick={toggleSidebar}
            className="nav-item flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] mb-1"
            aria-label="Toggle sidebar"
          >
            <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0">
              <span className={`${iconClass} transition-transform duration-300 ease-in-out`}
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
                {isCollapsed ? 'menu' : 'close'}
              </span>
            </div>
            <span className={`font-medium text-sm transition-all duration-300 ${
              isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
            }`}>
              القائمة
            </span>
          </button>

          {/* Home */}
          <div className="relative group w-full">
            <Link
              href="/dashboard"
              className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-xl ${
                pathname === '/dashboard' ? 'nav-active' : 'nav-item'
              }`}
            >
              <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0">
                <span
                  className={`${iconClass} nav-icon transition-colors duration-200`}
                  style={{ color: pathname === '/dashboard' ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
                >
                  home
                </span>
              </div>
              <span className={`font-medium text-sm transition-all duration-300 ${
                isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
              }`}>
                الرئيسية
              </span>
            </Link>
            <Tooltip isCollapsed={isCollapsed} text="الرئيسية" />
          </div>
        </div>

        {/* Divider */}
        <div className="divider-dark flex-shrink-0" />

        {/* ── Action Buttons ── */}
        <div className="flex flex-col py-3 gap-1 w-full">
          {actionButtons.map((btn) => {
            const isActive = pathname === btn.path;
            return (
              <div key={btn.path} className="relative group w-full">
                <Link
                  href={btn.path}
                  className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] rounded-xl transition-all duration-300 overflow-hidden whitespace-nowrap relative ${
                    isActive ? '' : 'hover:bg-white/5'
                  }`}
                  style={isActive ? {
                    backgroundColor: btn.color,
                    boxShadow: `0 4px 20px ${btn.glow}`,
                  } : {}}
                >
                  <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0">
                    <span
                      className={`${iconClass} nav-icon transition-colors duration-200`}
                      style={{ color: isActive ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
                    >
                      {btn.icon}
                    </span>
                  </div>
                  <span className={`font-medium text-sm transition-all duration-300 ${
                    isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
                  } ${isActive ? 'text-white' : 'text-white'}`}>
                    {btn.label}
                  </span>
                  {btn.comingSoon && !isCollapsed && (
                    <span className="ml-auto mr-3 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                      قريباً
                    </span>
                  )}
                </Link>
                <Tooltip isCollapsed={isCollapsed} text={btn.comingSoon ? `${btn.label} (قريباً)` : btn.label} />
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="divider-dark flex-shrink-0" />

        {/* ── Nav Links ── */}
        <nav className="flex flex-col py-3 gap-1 flex-1 w-full">
          {navLinks.map((item) => {
            const active = pathname === item.path;
            return (
              <div key={item.path} className="relative group w-full">
                <Link
                  href={item.path}
                  className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-xl ${
                    active ? 'nav-active' : 'nav-item'
                  }`}
                >
                  <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0">
                    <span
                      className={`${iconClass} nav-icon transition-colors duration-200`}
                      style={{ color: active ? 'var(--tq-text-primary)' : 'var(--tq-muted)' }}
                    >
                      {item.icon}
                    </span>
                  </div>
                  <span className={`font-medium text-sm transition-all duration-300 ${
                    isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
                  }`}>
                    {item.label}
                  </span>
                </Link>
                <Tooltip isCollapsed={isCollapsed} text={item.label} />
              </div>
            );
          })}
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
                  className="w-[36px] h-[36px] rounded-full object-cover tq-avatar-ring"
                />
              ) : (
                <div className="w-[36px] h-[36px] rounded-full tq-avatar-fallback text-sm">
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
                className="glass-dropdown rounded-2xl shadow-2xl p-2"
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
    </aside>
  );
}
