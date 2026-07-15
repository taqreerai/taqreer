"use client";

// SlideCapUpsellDialog — the free-tier "you're capped at N slides" upsell shown
// when a free user clicks Generate. Two choices: upgrade (opens the pricing
// UpgradeModal) or continue.
//
// This is NOT a new modal pattern: it reuses the canonical dialog shell 1-for-1
// (same as CancelGenerationDialog / ShareDialog) — `.modal-dim` overlay,
// `surface-modal` glass panel via createPortal, Esc + click-outside close,
// body-scroll lock — and the design-system button primitives (`.btn-gradient`
// primary, `.btn-pill` secondary, the same pair UpgradeModal uses). Copy lives
// in dict.flows.generate.slideCapUpsell (bilingual); the cap / max numbers are
// injected from config, never hardcoded.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function SlideCapUpsellDialog({
  open,
  onClose,
  onContinue,
  onUpgrade,
  cap,
  max,
}: {
  open: boolean;
  // Dismiss WITHOUT proceeding — the X, Esc, and outside-click. Cancels the
  // Generate the user clicked.
  onClose: () => void;
  // Continue — the affirmative footer action: proceed with generation (capped).
  // Distinct from onClose so a dismiss gesture never triggers a generation.
  onContinue: () => void;
  // Upgrade now — parent closes this and opens the pricing UpgradeModal.
  onUpgrade: () => void;
  // The free tier's slide cap (from config) and the system max (upgrade target).
  cap: number;
  max: number;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.flows.generate.slideCapUpsell;

  // Body-scroll lock while open — same shape CancelGenerationDialog uses.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof window === "undefined") return null;

  // Latin numerals only, even inside Arabic copy (String(number) is 0-9).
  const body = t.body
    .replace("{cap}", String(cap))
    .replace("{max}", String(max));

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="slidecap-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          <motion.div
            key="slidecap-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4"
          >
            <div
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="slidecap-upsell-title"
              onClick={(e) => e.stopPropagation()}
              className="surface-modal pointer-events-auto flex w-[min(100vw-24px,440px)] flex-col overflow-hidden rounded-2xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-foreground/[0.08] px-5 py-4">
                <h2
                  id="slidecap-upsell-title"
                  className="text-base font-semibold text-foreground"
                >
                  {t.title}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
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
                  {body}
                </p>
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-foreground/[0.08] px-5 py-3">
                <button
                  type="button"
                  onClick={onContinue}
                  className="btn-pill px-5 py-2 text-sm"
                >
                  {t.continue}
                </button>
                <button
                  type="button"
                  onClick={onUpgrade}
                  className="btn-gradient px-5 py-2 text-sm"
                >
                  {t.upgrade}
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
