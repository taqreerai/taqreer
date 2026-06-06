"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BellDropdown } from "@/components/app/BellDropdown";
import { HeaderSearch } from "@/components/app/HeaderSearch";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";
import { ServerStatusChip } from "@/components/app/ServerStatusChip";

type Props = {
  isCollapsed?: boolean;
  onToggleSidebar?: () => void;
  // When true (distraction-free /project editing) the header slides up off the
  // top + fades out. Transform is owned by framer; the CSS transition below
  // covers only `right` (the sidebar-collapse reflow) so the two don't fight.
  hidden?: boolean;
};

// Icon-only header button — NO background, no border, just the icon
// with a hover colour lift. Shared by the sidebar toggle + the theme /
// language switches so they line up as one clean icon cluster.
const HEADER_ICON_BTN =
  "flex h-11 w-11 items-center justify-center text-white/60 transition-colors hover:text-white";

export function Header({ isCollapsed, onToggleSidebar, hidden = false }: Props) {
  // Owns the global "Start a new project" picker so the four
  // landing flows are reachable from any page, not just the
  // dashboard's QuickActions row.
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <motion.header
      initial={false}
      animate={{ y: hidden ? "-100%" : "0%", opacity: hidden ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      style={{ pointerEvents: hidden ? "none" : "auto" }}
      className={`header-bg backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed top-0 left-0 z-40 h-20 flex items-center px-8 transition-[right] duration-300 ease-in-out ${
        isCollapsed ? "right-[80px]" : "right-[260px]"
      }`}
    >
      <div className="relative w-full flex items-center justify-between">
        {/* Right group: sidebar toggle + static theme / language
            switches. All ICON-ONLY now (no glass circle) — the toggle
            shed its `rounded-full` border + backdrop to match the bell.
            The theme + AR/EN switches are visual placeholders for now;
            they'll be wired with the points/subscription work. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isCollapsed ? "فتح القائمة الجانبية" : "إغلاق القائمة الجانبية"}
            aria-expanded={!isCollapsed}
            className={HEADER_ICON_BTN}
          >
            {/* Animated burger ↔ cross — `menu` ↔ `close` with a 90°
                rotate across the 300 ms collapse transition. */}
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

          {/* Placeholder controls — theme + language toggles aren't wired
              yet. aria-disabled + tabIndex=-1 keep AT/keyboard users from
              landing on dead controls; "(قريباً)" marks them as upcoming. */}
          <button
            type="button"
            aria-label="تبديل السمة (قريباً)"
            aria-disabled="true"
            tabIndex={-1}
            className={HEADER_ICON_BTN}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
              light_mode
            </span>
          </button>

          <button
            type="button"
            aria-label="تبديل اللغة (عربي / إنجليزي) (قريباً)"
            aria-disabled="true"
            tabIndex={-1}
            className={`${HEADER_ICON_BTN} text-[13px] font-semibold`}
          >
            <span aria-hidden>ع</span>
            <span className="mx-0.5 text-white/25" aria-hidden>
              /
            </span>
            <span className="text-white/35" aria-hidden>
              EN
            </span>
          </button>
        </div>

        {/* Center: HeaderSearch — absolutely centered in the header so it
            stays visually centered no matter how wide the side groups get
            (the status chip would otherwise nudge it off-center).
            pointer-events-none on the wrapper + auto on the field keeps
            the empty side-padding from intercepting clicks meant for the
            actions behind it on narrow widths. */}
        {/* Width scales with viewport so the centered field can't grow into
            the action clusters on narrow desktops (where a fixed max-w-xl
            would overlap the bell / new-project group + the status chip and
            steal their clicks). */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-full max-w-xs -translate-x-1/2 -translate-y-1/2 px-4 md:max-w-md lg:max-w-xl">
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
    </motion.header>
  );
}
