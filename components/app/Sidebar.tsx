"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";

export function Sidebar({
  isCollapsed = false,
  toggleSidebar
}: {
  isCollapsed?: boolean;
  toggleSidebar?: () => void;
}) {
  const pathname = usePathname();

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

  const Tooltip = ({ text }: { text: string }) => {
    if (!isCollapsed) return null;
    return (
      <div className="sidebar-tooltip absolute right-full top-1/2 -translate-y-1/2 mr-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
        {text}
      </div>
    );
  };

  const iconClass = "material-symbols-outlined text-[20px] flex-shrink-0 font-light";

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
              className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-xl border-r-2 ${
                pathname === '/dashboard' ? 'nav-active' : 'nav-item border-transparent'
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
            <Tooltip text="الرئيسية" />
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
                  className="flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] rounded-xl transition-all duration-300 overflow-hidden whitespace-nowrap relative"
                  style={isActive ? {
                    backgroundColor: btn.color,
                    boxShadow: `0 4px 20px ${btn.glow}`,
                  } : {}}
                >
                  {/* Hover overlay */}
                  {!isActive && (
                    <div
                      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{ backgroundColor: btn.color, boxShadow: `0 4px 20px ${btn.glow}` }}
                    />
                  )}
                  <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0 relative z-10">
                    <span
                      className={`${iconClass} nav-icon transition-colors duration-200`}
                      style={{ color: isActive ? '#ffffff' : 'var(--tq-muted)' }}
                    >
                      {btn.icon}
                    </span>
                  </div>
                  <span className={`font-medium text-sm relative z-10 transition-all duration-300 ${
                    isCollapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto'
                  } ${isActive ? 'text-white' : 'text-white group-hover:text-white'}`}>
                    {btn.label}
                  </span>
                </Link>
                <Tooltip text={btn.label} />
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
                  className={`flex items-center mx-[18px] w-[calc(100%-36px)] h-[44px] overflow-hidden whitespace-nowrap transition-all duration-300 rounded-xl border-r-2 ${
                    active ? 'nav-active' : 'nav-item border-transparent'
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
                <Tooltip text={item.label} />
              </div>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="divider-dark flex-shrink-0" />

        {/* ── Avatar ── */}
        <div className="flex items-center mx-[18px] w-[calc(100%-36px)] h-[64px] flex-shrink-0">
          <div className="w-[44px] h-[44px] flex justify-center items-center flex-shrink-0">
            <img
              alt="أسامة avatar"
              className="avatar-ring h-[36px] w-[36px] rounded-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBIemRiH3GmYrpTuw-Ef2ymnltcDQvirh5Ua5yuZfeUFDXgrb6Qr0136fQRGeWIgVd1Xo5IRK7l-VeDfmwZPZTEew4ZhzlvMGLZEZT_qRBxLlhVpodAUTLRPYLFD_yfnAlyxoo8u6jBc3nq2s0T25WCYaJKnE8Rd7eXxzKErEUnc94RpifEFLsLAXeQ4mUZSUQ0JM-ZzaE-OeoBPfWekNmGOaHiCcejgkXVWbwSEsZKev293na2HfMNc-_72zO1gA98NMImtjVGTbA"
            />
          </div>
          <div className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-300 ${
            isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100 pr-2'
          }`}>
            <span className="font-medium text-white text-sm leading-tight">أسامة</span>
            <span className="text-muted text-[11px]">osama@example.com</span>
          </div>
        </div>

        {/* ── Usage Bar ── */}
        <div className={`sidebar-usage flex-shrink-0 transition-all duration-300 overflow-hidden px-[18px] ${
          isCollapsed ? 'h-0 opacity-0 py-0' : 'h-[56px] opacity-100 py-3'
        }`}>
          <div className="flex justify-between text-xs mb-1.5 font-medium text-muted">
            <span>الاستخدام</span>
            <span>3 من 30 عرضًا</span>
          </div>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: '10%' }} />
          </div>
        </div>
      </div>
    </aside>
  );
}
