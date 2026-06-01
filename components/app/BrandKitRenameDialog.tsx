"use client";

// Rename dialog for a brand kit. Sibling-overlay pattern (dim + panel
// as siblings inside AnimatePresence), same recipe as
// `BrandKitDeleteConfirmDialog`. A single text input seeded with the
// current name; Enter (form submit) or the save button commits when
// the trimmed name is non-empty and actually changed.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export function BrandKitRenameDialog({
  open,
  currentName,
  busy,
  onCancel,
  onSave,
}: {
  open: boolean;
  currentName: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(currentName);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reseed the input to the current name each time the dialog opens.
  // Adjusting state during render (guarded by the open transition) per
  // React's "you might not need an effect" guidance — avoids a
  // setState-in-effect cascade.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(currentName);
  }

  // Focus + select the input once the open animation has mounted it.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.select(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (typeof document === "undefined") return null;

  const trimmed = value.trim();
  const canSave = !!trimmed && trimmed !== currentName.trim() && !busy;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="brand-kit-rename-dim"
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
            key="brand-kit-rename-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4"
          >
            <motion.form
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="brand-kit-rename-title"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                if (canSave) onSave(trimmed);
              }}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="glass-modal backdrop-blur-glass-boost pointer-events-auto mt-[20vh] w-full max-w-md rounded-2xl p-8 shadow-2xl"
            >
              <h3
                id="brand-kit-rename-title"
                className="mb-4 text-xl font-bold text-white"
              >
                إعادة تسمية الهوية
              </h3>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={120}
                disabled={busy}
                placeholder="اسم الهوية"
                aria-label="اسم الهوية"
                className="input-dark mb-8 w-full"
                style={{ height: 44, padding: "0 16px" }}
              />
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
                  type="submit"
                  disabled={!canSave}
                  className="btn-gradient flex-1 px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "جاري الحفظ..." : "حفظ"}
                </button>
              </div>
            </motion.form>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
