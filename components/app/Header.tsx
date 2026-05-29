"use client";

import { useState } from "react";
import { BellDropdown } from "@/components/app/BellDropdown";
import { HeaderSearch } from "@/components/app/HeaderSearch";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";
import { ServerStatusChip } from "@/components/app/ServerStatusChip";

type Props = {
  isCollapsed?: boolean;
  onToggleSidebar?: () => void;
};

export function Header({ isCollapsed, onToggleSidebar }: Props) {
  // Owns the global "Start a new project" picker so the four
  // landing flows are reachable from any page, not just the
  // dashboard's QuickActions row.
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <header
      className={`header-bg backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed top-0 left-0 z-40 h-20 flex items-center px-8 transition-all duration-300 ease-in-out ${
        isCollapsed ? "right-[80px]" : "right-[260px]"
      }`}
    >
      <div className="relative w-full flex items-center justify-between">
        {/* Right: Sidebar toggle — same glass-button recipe as the
            bell (h-11 w-11 rounded-full + backdrop-blur + low-alpha
            border). Replaced the previous "مرحباً" greeting so the
            collapse control lives in one place instead of being
            duplicated inside the sidebar itself. The Sidebar
            component no longer renders its own burger row. */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isCollapsed ? "فتح القائمة الجانبية" : "إغلاق القائمة الجانبية"}
          aria-expanded={!isCollapsed}
          className="backdrop-blur-glass backdrop-saturate-(--glass-saturation) relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/60 transition-colors hover:border-white/60 hover:text-white"
        >
          {/* Animated burger ↔ cross — restores the original
              sidebar-burger recipe (icon swap `menu` ↔ `close` with
              a 90° rotate during the 300 ms transition). Was lost
              briefly when the toggle moved to the header and the
              rotate transform got dropped alongside the wrong icon
              pair (`menu_open` instead of `close`). */}
          <span
            className="material-symbols-outlined transition-transform duration-300 ease-in-out"
            style={{
              fontSize: 22,
              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
            }}
            aria-hidden
          >
            {isCollapsed ? "menu" : "close"}
          </span>
        </button>

        {/* Center: HeaderSearch — absolutely centered in the header so it
            stays visually centered no matter how wide the side groups get
            (the status chip would otherwise nudge it off-center).
            pointer-events-none on the wrapper + auto on the field keeps
            the empty side-padding from intercepting clicks meant for the
            actions behind it on narrow widths. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 px-4">
          <div className="pointer-events-auto">
            <HeaderSearch />
          </div>
        </div>

        {/* Left: Actions */}
        <div className="flex items-center gap-4">
          <ServerStatusChip />
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
