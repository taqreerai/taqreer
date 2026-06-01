"use client";

// CancelGenerationDialog — confirmation modal for the cancel-pill
// in SlideNavSidebar. Mirrors the ShareDialog modal shell pattern
// 1-for-1 so the visual language stays consistent:
//
//   • `.modal-dim` overlay at z-[1000]
//   • Glass panel at z-[1001], `glass-popover backdrop-blur-glass
//     backdrop-saturate-(--glass-saturation)` surface, `rounded-2xl`,
//     dark glass border
//   • Esc + click-outside both close (when not busy)
//   • Body-scroll lock while open
//   • createPortal so the panel escapes any transformed ancestor
//     (otherwise backdrop-blur would render against the slide canvas
//     instead of the page chrome)
//
// Discard-all policy: the modal body explicitly tells the user that
// any partially-generated slides will be removed. Matches the
// product call (2026-05-27, "cancel means start over").

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

export function CancelGenerationDialog({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  // Called when the user clicks "تأكيد الإلغاء". Parent does the
  // POST + state cleanup; this component is purely chrome.
  onConfirm: () => void;
  // True while the cancel request is in flight. Disables both buttons
  // and dims the modal so the user can't double-fire / dismiss
  // mid-request.
  busy: boolean;
}) {
  // Body-scroll lock while open — same shape as ShareDialog uses.
  // Restoring `overflow` to its prior value (vs. forcing "auto")
  // respects whatever upstream style the page may have set.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc closes when not busy.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          {/* Dim overlay — same canonical `.modal-dim` ShareDialog
              uses (color-mix(in oklab, black 70%, transparent), locked
              2026-05-23). No per-modal brightness override. */}
          <motion.div
            key="cancel-dim"
            onClick={() => {
              if (!busy) onClose();
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          {/* Panel wrapper — same trap-free pattern as ShareDialog:
              don't transform the panel (would create a stacking
              context and trap backdrop-blur), animate only opacity. */}
          <motion.div
            key="cancel-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-gen-title"
              onClick={(e) => e.stopPropagation()}
              className="glass-modal backdrop-blur-glass-boost pointer-events-auto flex w-[min(100vw-24px,440px)] flex-col overflow-hidden rounded-2xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
                <h2
                  id="cancel-gen-title"
                  className="text-base font-semibold text-white"
                >
                  إلغاء الإنشاء
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="إغلاق"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18 }}
                  >
                    close
                  </span>
                </button>
              </header>

              <div className="px-5 py-5">
                <p className="text-sm leading-relaxed text-white/80">
                  هل تريد إلغاء عملية الإنشاء؟ سيتم إيقاف Claude فوراً وحذف
                  الشرائح التي تم إنشاؤها حتى الآن.
                </p>
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  متابعة الإنشاء
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-red-200/30 border-t-red-100" />
                  ) : (
                    <span
                      className="material-symbols-outlined leading-none"
                      style={{ fontSize: 16 }}
                      aria-hidden
                    >
                      stop_circle
                    </span>
                  )}
                  {busy ? "جارٍ الإلغاء..." : "تأكيد الإلغاء"}
                </button>
              </footer>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
