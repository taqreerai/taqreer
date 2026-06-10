"use client";

// Confirmation dialog for deleting a template.
//
// Sibling-overlay pattern (per CR 2026-05-22): the dim layer and the
// panel wrapper are SIBLINGS inside AnimatePresence, NOT a nested
// dim-with-panel-as-child structure. That keeps the panel's backdrop-
// blur sampling the dim+page composite cleanly — the nested layout
// would have made the panel sample WITHIN the dim's stacking context
// and broken the glass refraction. Same shape used by
// SaveAsTemplateDialog / TemplateLightbox / AllNotificationsModal.
//
// `.modal-dim` + `backdrop-brightness-75` produces the dimming via
// backdrop-filter (no own bg-color) so the panel's own
// `` still has unbleached page content to blur.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export function TemplateDeleteConfirmDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
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
          {/* Dim overlay — sibling of the panel wrapper. Click-outside
              cancellation lives on this layer; the panel below opts back
              into pointer events via its own className. */}
          <motion.div
            key="template-delete-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              if (!busy) onCancel();
            }}
            className="modal-dim fixed inset-0 z-[1200]"
          />

          {/* Panel wrapper — sibling of the dim. NOT animated (the
              earlier nested-then-promoted-to-motion experiments
              proved that animated transform/opacity ancestors trap
              the surface-modal's backdrop-blur). Click-outside is
              handled by the dim's onClick above; the panel itself
              has `pointer-events-auto` to receive its own clicks. */}
          <div
            key="template-delete-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4"
          >
            <motion.div
              dir="rtl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="template-delete-title"
              aria-describedby="template-delete-body"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto mt-[20vh] w-full max-w-md rounded-2xl p-8"
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
                سيتم حذف هذا القالب بشكل نهائي مع شرائحه. لا يمكن التراجع عن هذا
                الإجراء.
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
