"use client";

// Generic bulk-delete confirmation (2026-06-12) - one dialog for all
// four library surfaces; the page passes its own title/body copy (the
// per-type dialogs keep their single-item flows). Canonical
// sibling-overlay recipe per TemplateDeleteConfirmDialog.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

export function BulkDeleteConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="bulk-delete-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              if (!busy) onCancel();
            }}
            className="modal-dim fixed inset-0 z-[1200]"
          />
          <div
            key="bulk-delete-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4"
          >
            <motion.div
              ref={panelRef}
              dir={dir}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="bulk-delete-title"
              aria-describedby="bulk-delete-body"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto mt-[20vh] w-full max-w-md rounded-2xl p-8"
            >
              <h3 id="bulk-delete-title" className="mb-2 text-xl font-bold text-foreground">
                {title}
              </h3>
              <p id="bulk-delete-body" className="mb-8 text-sm text-muted">
                {body}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="btn-pill flex-1 px-4 py-3 text-sm"
                >
                  {dict.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className="btn-pill-danger flex-1 px-4 py-3 text-sm"
                >
                  {busy ? dict.common.deleting : confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
