"use client";

// Confirmation dialog for deleting a brand kit. Sibling-overlay
// pattern (dim + panel as siblings inside AnimatePresence) per the
// CR 2026-05-22 finding — same recipe `TemplateDeleteConfirmDialog`
// uses. See that file for the full structural reasoning.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export function BrandKitDeleteConfirmDialog({
  open,
  brandKitName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  brandKitName: string;
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
        <>
          <motion.div
            key="brand-kit-delete-dim"
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
            key="brand-kit-delete-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4"
          >
            <motion.div
              dir="rtl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="brand-kit-delete-title"
              aria-describedby="brand-kit-delete-body"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto mt-[20vh] w-full max-w-md rounded-2xl p-8"
            >
              <h3
                id="brand-kit-delete-title"
                className="mb-2 text-xl font-bold text-white"
              >
                حذف هوية الشركة
              </h3>
              <p
                id="brand-kit-delete-body"
                className="mb-8 text-sm text-muted"
              >
                {brandKitName
                  ? `سيتم حذف "${brandKitName}" بشكل نهائي. لن تتأثر العروض الموجودة التي استخدمت هذه الهوية.`
                  : "سيتم حذف هذه الهوية بشكل نهائي. لن تتأثر العروض الموجودة التي استخدمتها."}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="btn-pill flex-1 px-4 py-3 text-sm"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className="btn-pill-danger flex-1 px-4 py-3 text-sm"
                >
                  {busy ? "جاري الحذف..." : "حذف نهائياً"}
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
