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
  toggleSidebar
}: {
  isCollapsed?: boolean;
  toggleSidebar?: () => void;
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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

  const actionButtons = [
    { label: 'إنشاء', icon: 'add_circle', color: '#370BF4', glow: 'rgba(55,11,244,0.4)', path: '/create' },
    { label: 'تحسين', icon: 'auto_fix_high', color: '#E036B8', glow: 'rgba(224,54,184,0.4)', path: '/enhance' },
    { label: 'محاكاة', icon: 'content_copy', color: '#9326C9', glow: 'rgba(147,38,201,0.4)', path: '/mimic' },
    { label: 'مخصص', icon: 'edit', color: '#7D2DFF', glow: 'rgba(125,45,255,0.4)', path: '/custom' },
  ];

  const navLinks = [
    { path: '/projects', icon: 'folder_managed', label: 'مشاريعي' },
    { path: '/templates', icon: 'grid_view', label: 'القوالب' },
    { path: '/brand-kits', icon: 'id_card', label: 'هوية الشركة' },
    { path: '/folders', icon: 'folder_copy', label: 'المجلدات' },
    { path: '/features', icon: 'stars', label: 'المميزات' },
    { path: '/settings', icon: 'settings', label: 'الإعدادات' },
  ];

  const iconClass = "material-symbols-outlined text-[20px] flex-shrink-0 font-thin";

  return (
    <aside
      aria-label="Sidebar"
      className={`sidebar-bg fixed right-0 top-0 h-screen z-50 flex flex-col border-l transition-all duration-300 ease-in-out ${
        isCollapsed ? "w-[80px]" : "w-[260px]"
      }`}
    >
      {/* ── Logo ── */}
      <div className="h-20 flex items-center px-[18px] flex-shrink-0 border-b border-[rgba(42,36,59,0.6)]">
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
                  style={{ color: pathname === '/dashboard' ? '#ffffff' : 'var(--tq-muted)' }}
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
                      style={{ color: isActive ? '#ffffff' : 'var(--tq-muted)' }}
                    >
                      {btn.icon}
                    </span>
                  </div>
                  <span className={`font-medium text-sm transition-all duration-300 ${
                    isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
                  } ${isActive ? 'text-white' : 'text-white'}`}>
                    {btn.label}
                  </span>
                </Link>
                <Tooltip isCollapsed={isCollapsed} text={btn.label} />
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
                      style={{ color: active ? '#ffffff' : 'var(--tq-muted)' }}
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
                  className="w-[36px] h-[36px] rounded-full object-cover ring-2 ring-[rgba(55,11,244,0.5)]"
                />
              ) : (
                <div className="w-[36px] h-[36px] rounded-full bg-gradient-to-r from-[#370BF4] to-[#E036B8] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-300 text-right ${
              isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100 pr-1'
            }`}>
              <span className="font-medium text-white text-sm leading-tight truncate">{name}</span>
              <span className="text-[#9A94A8] text-[11px] truncate">{email}</span>
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
                className="bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-2xl shadow-xl p-2"
              >
                <div className="px-3 py-2">
                  <p className="font-semibold text-white text-sm truncate">{name}</p>
                  <p className="text-[#9A94A8] text-xs truncate">{email}</p>
                </div>
                <div className="divider-dark my-1" />
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 text-[#9A94A8] hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px] font-thin">settings</span>
                  <span className="text-sm">الإعدادات</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 text-[#9A94A8] hover:text-white transition-colors cursor-pointer w-full"
                >
                  <span className="material-symbols-outlined text-[18px] font-thin">logout</span>
                  <span className="text-sm">تسجيل الخروج</span>
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
