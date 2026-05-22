"use client";

// Confirmation dialog for deleting a template. Same structural shape as
// TrashConfirmDialog (uses `.glass-modal` chrome, click-outside +
// Esc to cancel, body-text + danger button at the bottom). Templates
// are hard-deleted along with their showcase PNGs in storage, so the
// gate is appropriate.
//
// Visual treatment differs from TrashConfirmDialog in only one place:
// this dialog uses the `.modal-dim backdrop-brightness-75` recipe
// (the new shared dim treatment) so the panel's glass blur isn't
// cancelled by an over-opaque dim layer.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export function TemplateDeleteConfirmDialog({
  open,
  templateTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  templateTitle: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
        <motion.div
          key="template-delete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="modal-dim backdrop-brightness-75 fixed inset-0 z-[1200] flex items-start justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) onCancel();
          }}
        >
          <motion.div
            key="template-delete-card"
            dir="rtl"
            initial={{ opacity: 0, scale: 0.95, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="glass-modal backdrop-blur-glass backdrop-saturate-(--glass-saturation) mt-[20vh] w-full max-w-md rounded-2xl p-8 shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="template-delete-title"
            aria-describedby="template-delete-body"
          >
            <h3
              id="template-delete-title"
              className="mb-2 text-xl font-bold text-white"
            >
              حذف القالب
            </h3>
            <p
              id="template-delete-body"
              className="mb-8 text-sm text-muted"
            >
              {templateTitle
                ? `سيتم حذف "${templateTitle}" بشكل نهائي مع شرائحه. لا يمكن التراجع عن هذا الإجراء.`
                : "سيتم حذف هذا القالب بشكل نهائي مع شرائحه. لا يمكن التراجع عن هذا الإجراء."}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="btn-outline-dark flex-1 px-4 py-3 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="btn-danger flex-1 px-4 py-3 font-medium disabled:opacity-50"
              >
                {busy ? "جاري الحذف..." : "حذف نهائياً"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
