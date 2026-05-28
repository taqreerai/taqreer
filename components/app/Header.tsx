"use client";

import { useState } from "react";
import { BellDropdown } from "@/components/app/BellDropdown";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";

export function Header({ isCollapsed }: { isCollapsed?: boolean }) {
  // Owns the global "Start a new project" picker. Triggered from
  // the header so the four landing flows are reachable from any
  // page, not just the dashboard's QuickActions row.
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <header
      className={`header-bg backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed top-0 left-0 z-40 h-20 flex items-center px-8 transition-all duration-300 ease-in-out ${
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
          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            className="btn-gradient px-6 py-2.5 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            مشروع جديد
          </button>
        </div>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
    </header>
  );
}
