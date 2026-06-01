"use client";

// Global "Start a new project" flow picker.
//
// Mounted from the app header's "مشروع جديد" button so the user can
// kick off any of the four landing flows from anywhere in the app.
// Mirrors `UseBrandKitDialog`'s 4-card grid (same QuickActions
// recipe — same icons + Arabic copy + .qa-card surface) so the
// dialogs read as a coordinated family.
//
// Differences vs `UseBrandKitDialog`:
//   • No "brand kit" context — the cards navigate straight to
//     `/${flow}`. The user's default brand kit (if set) hydrates
//     on the destination page's mount effect via
//     `fetchDefaultBrandKit`, so no extra wiring is needed here.
//   • No busy / picking state — navigation is synchronous from
//     the user's perspective.
//
// Centered vertically + horizontally, same as ShareDialog. Sibling-
// overlay pattern (dim + panel as AnimatePresence siblings) per the
// CR 2026-05-22 finding — preserves the panel's glass refraction.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { BRAND_FLOW_CARDS } from "@/components/app/brandFlowCards";

export function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
            key="new-project-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="modal-dim fixed inset-0 z-[1200]"
          />

          <div
            key="new-project-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4"
          >
            <motion.div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-project-title"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="glass-modal backdrop-blur-glass-boost pointer-events-auto w-full max-w-3xl rounded-2xl p-8 shadow-2xl"
            >
              <header className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="new-project-title"
                    className="mb-1 text-xl font-bold text-white"
                  >
                    ابدأ مشروعاً جديداً
                  </h3>
                  <p className="text-sm text-muted">
                    اختر التدفق المناسب لمحتواك — ستُعبأ هويتك البصرية
                    الافتراضية تلقائياً إذا كانت محفوظة.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="إغلاق"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-white"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20 }}
                  >
                    close
                  </span>
                </button>
              </header>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {BRAND_FLOW_CARDS.map((card) => (
                  // `next/link` for SPA routing — was a plain anchor
                  // that forced a full page reload on every flow pick
                  // (CR #41 finding).
                  <Link
                    key={card.flow}
                    href={`/${card.flow}`}
                    onClick={onClose}
                    // Same `.qa-card` recipe the dashboard QuickActions
                    // + UseBrandKitDialog use — keeps the picker
                    // visually consistent across the three surfaces.
                    className="qa-card group relative flex cursor-pointer flex-col gap-3 p-4 text-right no-underline transition-all duration-200"
                  >
                    <div>
                      <span className="material-symbols-outlined text-[20px] text-muted transition-colors group-hover:text-white">
                        {card.icon}
                      </span>
                    </div>
                    <div>
                      <h4 className="mb-0.5 text-[13px] font-semibold leading-snug text-white">
                        {card.title}
                      </h4>
                      <p className="text-[11px] leading-relaxed text-muted">
                        {card.desc}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
