"use client";

// Header avatar menu - the SAME avatar (ProfileAvatar: disc + credit
// ring) and the SAME menu body (ProfileMenuContent) as the dashboard
// sidebar, just anchored to a header button and opening DOWNWARD.
// First consumer: the studio header strip (2026-06-12).

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "@/hooks/useUser";
import { ProfileAvatar } from "@/components/app/ProfileAvatar";
import { ProfileMenuContent } from "@/components/app/ProfileMenuContent";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";

export function UserMenu() {
  const { user, name, email } = useUser();
  const [open, setOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name || email}
        className="block cursor-pointer transition-transform hover:scale-105"
      >
        <ProfileAvatar />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            // start-0: the avatar lives at the strip's inline-START edge
            // (right edge in AR), so the menu must expand toward the
            // content - inset-inline-start pins the correct side in both
            // directions (end-0 pushed it off-screen in RTL).
            className="surface-menu absolute start-0 top-12 z-[60] w-64 rounded-2xl p-2 max-h-[calc(100vh-4rem)] overflow-y-auto hide-scrollbar"
          >
            <ProfileMenuContent
              onClose={() => setOpen(false)}
              onNewProject={() => setNewProjectOpen(true)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}
