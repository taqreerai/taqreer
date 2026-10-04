"use client";

// "Show all" for the Design card's two scrolling pickers (templates and
// colour templates, 2026-10-04 owner direction): a small trigger under the
// list and a large modal that shows the whole set at once. Same modal shell
// as UpgradeModal (modal-dim + surface-modal); Escape or the dim closes it.

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function PickerExpandButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 self-end rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--tq-violet)] transition-colors hover:bg-[var(--tq-violet)]/10 disabled:opacity-50"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>
        open_in_full
      </span>
      {dict.flows.design.showAll}
    </button>
  );
}

export function PickerExpandModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dict = useDict();
  const { dir } = useLocale();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
            key="picker-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="modal-dim fixed inset-0 z-[1200]"
          />
          <div className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4">
            <motion.div
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[var(--tq-border-hairline)] px-5 py-4">
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={dict.common.close}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              </header>
              <div className="overflow-y-auto p-5">{children}</div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
