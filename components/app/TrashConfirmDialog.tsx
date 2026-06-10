"use client";

// Confirmation modal for the "Send to trash" menu item on
// ProjectThumbnail. Hard-delete is irreversible (no soft-delete
// column; storage thumbnails are wiped server-side), so the dialog
// is gating — the user must explicitly confirm.
//
// Mirrors the settings-page delete-account modal: dim overlay + glass
// content sibling, AnimatePresence in/out, click-outside-to-cancel,
// Esc-to-cancel. Reusable enough to host any single destructive
// confirmation later (e.g. delete brand kit) — kept narrow to "trash
// a project" semantics so the copy reads naturally without props
// for every string.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function TrashConfirmDialog({
  open,
  projectTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  // Shown in the body copy. Empty string is allowed (renders the
  // dialog without the quoted name) — useful if the parent hasn't
  // resolved the title yet, though normally it always passes one.
  projectTitle: string;
  // True while the DELETE round-trip is in flight. Disables the
  // confirm + cancel buttons so the user can't double-fire or close
  // before the server responds (the cancel-during-deletion case
  // would leave the parent's optimistic "removing" state stuck).
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  // Esc closes the dialog — but ONLY while not busy. Closing
  // mid-delete would dismiss the spinner without aborting the
  // request, leaving the user without feedback when it lands.
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
          key="trash-confirm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="modal-dim fixed inset-0 z-[1200] flex items-start justify-center p-4"
          onClick={(e) => {
            // Click on the dim overlay (NOT a descendant) cancels.
            // `e.target === e.currentTarget` is how the settings
            // delete modal does it; copying the convention so the
            // entire codebase reads consistently.
            if (e.target === e.currentTarget && !busy) onCancel();
          }}
        >
          <motion.div
            key="trash-confirm-card"
            dir={dir}
            initial={{ opacity: 0, scale: 0.95, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="surface-modal mt-[20vh] w-full max-w-md rounded-2xl p-8"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="trash-confirm-title"
            aria-describedby="trash-confirm-body"
          >
            <h3
              id="trash-confirm-title"
              className="mb-2 text-xl font-bold text-white"
            >
              {dict.dialogs.trashConfirm.title}
            </h3>
            <p
              id="trash-confirm-body"
              className="mb-8 text-sm text-muted"
            >
              {projectTitle
                ? dict.dialogs.trashConfirm.bodyNamed.replace("{title}", projectTitle)
                : dict.dialogs.trashConfirm.body}
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
                {busy ? dict.common.deleting : dict.common.deletePermanently}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
