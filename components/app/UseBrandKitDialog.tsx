"use client";

// "Use this brand kit" flow picker.
//
// Glass-modal with 4 cards mirroring the dashboard's `QuickActions`
// flow grid — same icons + Arabic titles + descriptions so the
// dialog reads as a continuation of the four canonical landing
// flows, not a generic chooser. Clicking a card fires `onPick`
// with the target flow; the caller is responsible for seeding
// sessionStorage and navigating.
//
// Sibling-overlay pattern (dim + panel siblings inside
// AnimatePresence) per the CR 2026-05-22 finding — preserves the
// panel's `backdrop-blur-glass` glass refraction. Same recipe as
// `TemplateDeleteConfirmDialog` and `SaveAsTemplateDialog`.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { BRAND_FLOW_CARDS } from "@/components/app/brandFlowCards";
import type { BrandKitTargetFlow } from "@/lib/create/seed-from-brand-kit";

export function UseBrandKitDialog({
  open,
  brandKitName,
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  brandKitName: string;
  // True while `onPick` is mid-flight. Disables all flow cards +
  // dims the modal so the user can't fire a second pick before the
  // seed + navigation settles. Caller controls this.
  busy?: boolean;
  onClose: () => void;
  onPick: (flow: BrandKitTargetFlow) => void;
}) {
  // Track which flow is currently being seeded so the picked card
  // can show a localized spinner instead of every card freezing
  // uniformly. Clears when `busy` returns false (error path —
  // successful picks navigate away before the reset ever runs) OR
  // when the dialog closes externally, so the next open starts
  // clean. Canonical "sync internal state to an external prop"
  // shape the lint rule explicitly allows; the `if` guard makes
  // the call a no-op when picking is already null, so no
  // cascading-render risk.
  const [picking, setPicking] = useState<BrandKitTargetFlow | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- internal-state reset on external prop change
    if (!busy || !open) setPicking(null);
  }, [busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="use-brand-kit-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              if (!busy) onClose();
            }}
            className="modal-dim fixed inset-0 z-[1200]"
          />

          <div
            key="use-brand-kit-wrapper"
            // Centered vertically + horizontally, same recipe as
            // ShareDialog. The previous `items-start mt-[10vh]`
            // pinned the panel to the top of the viewport which
            // read off-balance on tall screens.
            className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4"
          >
            <motion.div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="use-brand-kit-title"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="glass-modal backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto w-full max-w-3xl rounded-2xl p-8 shadow-2xl"
            >
              <header className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="use-brand-kit-title"
                    className="mb-1 text-xl font-bold text-white"
                  >
                    استخدام هوية الشركة
                  </h3>
                  <p className="text-sm text-muted">
                    {brandKitName
                      ? `اختر التدفق الذي تريد استخدام "${brandKitName}" فيه. سيتم تعبئة الألوان والخطوط والشعار تلقائياً.`
                      : "اختر التدفق الذي تريد استخدام الهوية فيه. سيتم تعبئة الألوان والخطوط والشعار تلقائياً."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="إغلاق"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
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
                {BRAND_FLOW_CARDS.map((card) => {
                  const isPicking = picking === card.flow;
                  return (
                    <button
                      key={card.flow}
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        setPicking(card.flow);
                        onPick(card.flow);
                      }}
                      // Reuse the dashboard's `.qa-card` recipe so the
                      // picker reads as a continuation of the four
                      // canonical landing tiles, not a generic dialog
                      // chooser.
                      className="qa-card group relative flex cursor-pointer flex-col gap-3 p-4 text-right transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div>
                        <span
                          className={`material-symbols-outlined text-[20px] transition-colors ${
                            isPicking
                              ? "text-white"
                              : "text-muted group-hover:text-white"
                          }`}
                        >
                          {isPicking ? "progress_activity" : card.icon}
                        </span>
                      </div>
                      <div>
                        <h4 className="mb-0.5 text-[13px] font-semibold leading-snug text-white">
                          {card.title}
                        </h4>
                        <p className="text-[11px] leading-relaxed text-muted">
                          {isPicking ? "جارٍ التحويل..." : card.desc}
                        </p>
                      </div>
                      {isPicking ? (
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-2xl ring-1 ring-white/20"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
