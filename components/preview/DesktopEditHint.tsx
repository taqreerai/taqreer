"use client";

// DesktopEditHint: one-time, dismissible notice shown to owners/editors who
// open the studio on a PHONE. Direct editing (double-click text, move/restyle
// elements) is desktop-only (`editMode = canEdit && !isMobileStudio` in
// DeckView), so mobile users can only change content through the paid AI path.
// This tells them the full editor lives on desktop, so they don't burn credits
// (or hit an out-of-credits wall) retyping a word that is free to edit on a
// computer.
//
// Chrome mirrors CancelGenerationDialog 1-for-1 (`.modal-dim` + `.surface-modal`
// + createPortal) so the visual language stays consistent. Dismissal is
// persisted by the parent (localStorage) so it never shows twice.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

export function DesktopEditHint({
  open,
  onDismiss,
}: {
  open: boolean;
  // Called on "Got it", the close button, Esc, or click-outside. Parent records
  // the dismissal (localStorage) so the hint is shown at most once.
  onDismiss: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.components.desktopEditHint;
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  // Body-scroll lock while open (same shape as CancelGenerationDialog).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="desktop-hint-dim"
            onClick={onDismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          <motion.div
            key="desktop-hint-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              ref={panelRef}
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="desktop-hint-title"
              onClick={(e) => e.stopPropagation()}
              className="surface-modal pointer-events-auto flex w-[min(100vw-24px,420px)] flex-col overflow-hidden rounded-2xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-foreground/[0.08] px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className="material-symbols-outlined text-foreground/70"
                    style={{ fontSize: 20 }}
                    aria-hidden
                  >
                    desktop_windows
                  </span>
                  <h2
                    id="desktop-hint-title"
                    className="text-base font-semibold text-foreground"
                  >
                    {t.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={t.close}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
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
                <p className="text-sm leading-relaxed text-foreground/80">
                  {t.body}
                </p>
              </div>

              <footer className="flex items-center justify-end border-t border-foreground/[0.08] px-5 py-3">
                <button type="button" onClick={onDismiss} className="btn-pill">
                  {t.gotIt}
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
