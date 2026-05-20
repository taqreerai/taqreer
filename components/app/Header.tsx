"use client";

import { BellDropdown } from "@/components/app/BellDropdown";

export function Header({ isCollapsed }: { isCollapsed?: boolean }) {
  return (
    <header
      className={`header-bg backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)] fixed top-0 left-0 z-40 h-20 flex items-center px-8 transition-all duration-300 ease-in-out ${
        isCollapsed ? "right-[80px]" : "right-[260px]"
      }`}
    >
      <div className="w-full flex items-center justify-between">

        {/* Right: Greeting */}
        <div className="flex items-center">
          <h2 className="text-[24px] font-semibold text-white">مرحباً، أسامة 👋</h2>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-xl mx-8">
          <div className="relative">
            <span className="material-symbols-outlined text-muted absolute right-3 top-1/2 -translate-y-1/2">
              search
            </span>
            <input
              className="input-search pr-10"
              placeholder="ابحث في مشاريعك..."
              type="text"
            />
          </div>
        </div>

        {/* Left: Actions */}
        <div className="flex items-center gap-4">
          <BellDropdown />
          <button className="btn-gradient px-6 py-2.5 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">add</span>
            مشروع جديد
          </button>
        </div>
      </div>
    </header>
  );
}
