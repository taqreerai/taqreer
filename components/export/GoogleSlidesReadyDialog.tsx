"use client";

// "Your deck is ready in Google Slides" confirmation - shown after the
// Drive upload completes (useExportActions.gslidesUrl). The Open button
// navigates from a FRESH click gesture, which is what makes the new tab
// popup-blocker-proof: an automatic window.open after the multi-second
// upload would be silently eaten.
//
// Sibling-overlay pattern (dim + panel) per the canonical dialogs; z-1200
// pair so it stacks above ShareDialog (z-1000/1001), same as UpgradeModal.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function GoogleSlidesReadyDialog({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const open = url !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="gslides-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="modal-dim fixed inset-0 z-[1200]"
          />
          <div
            key="gslides-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4"
          >
            <motion.div
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gslides-ready-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto flex w-full max-w-md flex-col gap-4 rounded-2xl p-6"
            >
              <div className="flex items-start gap-3">
                <span
                  className="material-symbols-outlined mt-0.5 text-[var(--tq-status-ok-dot)]"
                  style={{ fontSize: 28 }}
                  aria-hidden
                >
                  check_circle
                </span>
                <div>
                  <h3
                    id="gslides-ready-title"
                    className="text-base font-semibold text-foreground"
                  >
                    {dict.editor.export.gslidesReadyTitle}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {dict.editor.export.gslidesReadyBody}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-pill px-4 py-2 text-sm"
                >
                  {dict.common.close}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (url) {
                      window.open(url, "_blank", "noopener,noreferrer");
                    }
                    onClose();
                  }}
                  className="btn-gradient px-5 py-2 text-sm"
                >
                  {dict.editor.export.gslidesOpen}
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
