"use client";

// CreditGateDialog - the production form of the /lab/billing approved
// designs (sections 2/4/5, review 2026-06-11). Renders the 402 payload
// POST /api/projects returns when the credit preflight blocks:
//
//   insufficient_credits → the two offers: reduce the slide count to
//     what the balance affords (hidden for exact 1:1 flows like
//     enhance, where fewer slides would mean truncation) or top up
//     (smallest covering pack, bolt + bold price; links to #pricing
//     until Stripe checkout lands in Phase B).
//   flow_locked / preset_locked / slide_cap_exceeded → NoticeCard with
//     an upgrade CTA.
//
// Sibling-overlay dialog pattern (dim + panel via AnimatePresence)
// per TemplateDeleteConfirmDialog.

import { useEffect } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { NoticeCard } from "@/components/common/NoticeCard";
import { TOPUP_PACKS } from "@/lib/credits/cost";
import { formatCredits, useCreditBalance } from "@/lib/credits/store";
import { normalizePlan } from "@/lib/plan";

// The 402 body POST /api/projects returns when preflight blocks.
export type CreditGatePayload = {
  error:
    | "insufficient_credits"
    | "flow_locked"
    | "preset_locked"
    | "slide_cap_exceeded";
  balance: number;
  slideCap: number | null;
  options: {
    reducedSlides: number | null;
    reducedCredits: number | null;
    cheaperPresets: string[];
    topupGap: number;
  } | null;
};

export function isCreditGatePayload(data: unknown): data is CreditGatePayload {
  if (!data || typeof data !== "object") return false;
  const error = (data as { error?: unknown }).error;
  return (
    error === "insufficient_credits" ||
    error === "flow_locked" ||
    error === "preset_locked" ||
    error === "slide_cap_exceeded"
  );
}

export function CreditGateDialog({
  gate,
  onClose,
  onReduce,
  // Hide the reduce offer for exact 1:1 flows (enhance) - fewer slides
  // there would mean truncating the source, which we never do.
  allowReduce = true,
}: {
  gate: CreditGatePayload | null;
  onClose: () => void;
  onReduce?: (slides: number) => void;
  allowReduce?: boolean;
}) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.components.creditGate;
  const open = gate !== null;
  // Top-ups are a SUBSCRIBER refill (user direction 2026-06-12). Free
  // users get the subscribe offer instead - they have no plan to
  // refill.
  const credits = useCreditBalance();
  const isFree = !credits || normalizePlan(credits.plan) === "free";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  const pricingHref = localizedHref("/plans", locale);

  // Smallest pack that covers the gap (falls back to the largest).
  const coveringPack = gate?.options
    ? TOPUP_PACKS.find((p) => p.credits >= gate.options!.topupGap) ??
      TOPUP_PACKS[TOPUP_PACKS.length - 1]
    : null;
  const needed = gate?.options ? gate.balance + gate.options.topupGap : 0;
  const showReduce =
    allowReduce &&
    gate?.options?.reducedSlides != null &&
    gate.options.reducedCredits != null;

  return createPortal(
    <AnimatePresence>
      {gate ? (
        <>
          <motion.div
            key="credit-gate-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="modal-dim fixed inset-0 z-[1200]"
          />
          <div
            key="credit-gate-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4"
          >
            <motion.div
              dir={dir}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="credit-gate-title"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto mt-[18vh] w-full max-w-md rounded-2xl"
            >
              {gate.error === "insufficient_credits" ? (
                <div className="p-8">
                  <h3
                    id="credit-gate-title"
                    className="mb-2 text-xl font-bold text-foreground"
                  >
                    {t.insufficientTitle}
                  </h3>
                  <p className="mb-6 text-sm text-muted">
                    {t.insufficientBody
                      .replace("{needed}", formatCredits(needed))
                      .replace("{have}", formatCredits(gate.balance))}
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {showReduce ? (
                      <button
                        type="button"
                        onClick={() => onReduce?.(gate.options!.reducedSlides!)}
                        className="btn-pill flex w-full items-center justify-between px-5 py-3 text-sm"
                      >
                        <span className="font-medium">
                          {t.reduceCta.replace(
                            "{slides}",
                            String(gate.options!.reducedSlides),
                          )}
                        </span>
                        <span className="text-xs text-muted">
                          {t.reduceHint.replace(
                            "{credits}",
                            formatCredits(gate.options!.reducedCredits!),
                          )}
                        </span>
                      </button>
                    ) : null}
                    {isFree ? (
                      // Free user: subscribing IS the offer. New tab so
                      // the flow behind the dialog keeps its filled-in
                      // state; the balance refreshes live on grant.
                      <button
                        type="button"
                        onClick={() =>
                          window.open(pricingHref, "_blank")
                        }
                        className="btn-gradient flex w-full items-center justify-center px-5 py-3 text-sm font-medium"
                      >
                        {t.subscribeCta}
                      </button>
                    ) : coveringPack ? (
                      // Subscriber: straight to checkout for the
                      // smallest covering pack - in a NEW TAB so the
                      // flow state survives the payment round-trip
                      // (user-reported loss 2026-06-12).
                      <button
                        type="button"
                        onClick={() =>
                          window.open(
                            `${localizedHref("/checkout", locale)}?price=topup_${coveringPack.key}&ctx=tab`,
                            "_blank",
                          )
                        }
                        className="btn-gradient flex w-full items-center justify-between px-5 py-3 text-sm"
                      >
                        <span className="font-medium">
                          {t.topupCta.replace(
                            "{credits}",
                            formatCredits(coveringPack.credits),
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="material-symbols-outlined leading-none"
                            style={{ fontSize: 16 }}
                            aria-hidden
                          >
                            bolt
                          </span>
                          <span className="font-bold" dir="ltr">
                            ${coveringPack.priceUsd}
                          </span>
                        </span>
                      </button>
                    ) : null}
                    <p className="text-center text-[11px] text-muted">
                      {isFree ? t.subscribeHint : t.topupHint}
                    </p>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <NoticeCard
                  icon={gate.error === "slide_cap_exceeded" ? "warning" : "lock"}
                  tone={gate.error === "slide_cap_exceeded" ? "warn" : "default"}
                  title={
                    gate.error === "flow_locked"
                      ? t.flowLockedTitle
                      : gate.error === "preset_locked"
                        ? t.presetLockedTitle
                        : t.capTitle
                  }
                  body={
                    gate.error === "flow_locked"
                      ? t.flowLockedBody
                      : gate.error === "preset_locked"
                        ? t.presetLockedBody
                        : t.capBody.replace(
                            "{cap}",
                            formatCredits(gate.slideCap ?? 0),
                          )
                  }
                  actions={
                    <>
                      <Link
                        href={pricingHref}
                        onClick={onClose}
                        className="btn-gradient px-5 py-2.5 text-center text-sm no-underline"
                      >
                        {t.seePlans}
                      </Link>
                      <button
                        type="button"
                        onClick={onClose}
                        className="btn-pill px-5 py-2.5 text-sm"
                      >
                        {t.notNow}
                      </button>
                    </>
                  }
                />
              )}
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
