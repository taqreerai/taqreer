"use client";

import { motion } from "framer-motion";

// Floating show/hide control for the app chrome (header + main sidebar) on the
// /project editing canvas. A glass pill pinned to the top-leading corner; the
// icon is a panel whose trailing pane (the sidebar's side, in RTL) fills in when
// the chrome is visible — so the glyph itself reads as the current state.
export function ChromeToggle({
  hidden,
  onToggle,
}: {
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-pressed={!hidden}
      aria-label={hidden ? "إظهار القائمة والرأس" : "إخفاء القائمة والرأس"}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed left-3 top-3 z-[60] flex h-9 w-9 items-center justify-center rounded-full text-white/65 shadow-lg transition-colors hover:text-white"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <line x1="15" y1="5" x2="15" y2="19" />
        {!hidden ? (
          <rect x="15.5" y="6" width="5" height="12" rx="1.5" fill="currentColor" stroke="none" opacity="0.4" />
        ) : null}
      </svg>
    </motion.button>
  );
}
