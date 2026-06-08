"use client";

// §24 (2026-06-09): a thin utility cluster pinned to the TOP of the content
// panel — search (icon + ⌘K hint), theme, and language. These used to live as
// rows inside the sidebar profile popup; the user moved them up here as
// icon-only controls, aligned to the start (visual right in RTL).
//
// Search opens a command-palette overlay (HeaderSearch in `palette` variant),
// triggerable by click or the ⌘K / Ctrl+K shortcut. Theme + language are
// present as icons (tooltipped) but not wired to a real theme/i18n system yet.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { HeaderSearch } from "@/components/app/HeaderSearch";

// One dark-pill tooltip — same look as the sidebar + editor-toolbox tooltips
// (.sidebar-tooltip / PreviewActionBar), so every tooltip in the app matches.
function IconTooltip({ text }: { text: string }) {
  return (
    <span
      dir="auto"
      className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-3 py-1.5 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
    >
      {text}
    </span>
  );
}

// A tooltipped, icon-only square control with the shared hover treatment.
function PlaceholderIconButton({ icon, label }: { icon: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <span className="material-symbols-outlined text-[20px]">{icon}</span>
      <IconTooltip text={label} />
    </button>
  );
}

export function TopUtilityBar() {
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K (Mac) / Ctrl+K — global open shortcut. Ignored while typing in a field
  // other than to open (it preventDefaults the browser's own ⌘K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Cluster — absolutely pinned to the panel's top-start corner (right in
          RTL). `pointer-events-none` on the rail + `auto` on the buttons lets
          clicks pass through the empty stretch to the content beneath. */}
      <div
        dir="rtl"
        className="pointer-events-none absolute inset-x-0 top-3 z-30 flex items-center justify-between px-5"
      >
        {/* Search — pinned to the start (visual right) */}
        <div className="pointer-events-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="بحث"
            className="group relative flex h-9 items-center gap-2 rounded-lg pl-2 pr-2.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <span className="material-symbols-outlined text-[20px]">search</span>
            <kbd className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none text-muted">
              ⌘K
            </kbd>
            <IconTooltip text="بحث" />
          </button>
        </div>

        {/* Theme + language — pinned to the end (visual left). Both are
            icon-only placeholders (not wired to a real theme/i18n system yet). */}
        <div className="pointer-events-auto flex items-center gap-1">
          <PlaceholderIconButton icon="light_mode" label="السمة" />
          <PlaceholderIconButton icon="translate" label="اللغة" />
        </div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

// Command-palette search overlay — a centered, dimmed dark panel that wraps
// HeaderSearch in its `palette` variant (input + inline results + footer hint).
// Portalled to body so it sits above everything. Esc / backdrop-click dismiss.
function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="search-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          {/* Centered wrapper — flex-centers the palette on the page. The
              motion lives on the wrapper so the panel itself stays a plain
              centered box (no transform conflict with the centering). */}
          <motion.div
            key="search-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              dir="rtl"
              className="pointer-events-auto w-[min(92vw,580px)] overflow-hidden rounded-xl"
              style={{
                background: "var(--glass-fill)",
                border: "1px solid var(--tq-border-hairline)",
              }}
            >
              <HeaderSearch autoFocus variant="palette" />
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
