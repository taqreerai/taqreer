"use client";

// Floating bulk-action bar for multi-select mode (2026-06-12) - shared
// by /projects, /templates, /brand-kits, /library. Bottom-centered
// pill (canonical solid surface, no blur) with the selection count,
// select-all, delete and cancel. Portalled to body so page overflow
// never clips it; slides up on mode entry.

import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function SelectionBar({
  open,
  count,
  onSelectAll,
  onDelete,
  onCancel,
  deleting = false,
}: {
  open: boolean;
  count: number;
  onSelectAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  deleting?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.common.bulk;
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          dir={dir}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 z-[900] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-2 py-2"
          role="toolbar"
          aria-label={t.select}
        >
          <span className="px-3 text-sm text-muted tabular-nums">
            {t.selectedCount.replace("{count}", String(count))}
          </span>
          <button type="button" onClick={onSelectAll} className="btn-pill px-4 py-2 text-sm">
            {t.selectAll}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={count === 0 || deleting}
            className="btn-pill-danger px-4 py-2 text-sm disabled:opacity-50"
          >
            {deleting
              ? t.deleting
              : t.delete.replace("{count}", String(count))}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            {dict.common.cancel}
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// The mode-toggle pill that lives next to each page's sort/filter
// controls. aria-pressed mirrors the mode.
export function SelectModeToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const dict = useDict();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`btn-pill flex items-center gap-1.5 px-4 py-2 text-sm ${
        active ? "outline outline-1 outline-[var(--tq-purple)]" : ""
      }`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
        check_circle
      </span>
      {dict.common.bulk.select}
    </button>
  );
}
