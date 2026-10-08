"use client";

// Upgrade modal (2026-06-12): opened by clicking a TIER-GATED preset in
// the generate menu (and reusable anywhere an upsell needs to complete
// without navigation). Two steps inside one modal:
//   1. "plans"    - the same pricing cards as /plans (BillingSection in
//                   its modal variant)
//   2. "checkout" - the same embedded Stripe form as /checkout
//                   (EmbeddedCheckout with redirect:'if_required'), so
//                   the card payment finishes INSIDE the modal and the
//                   user's in-flight flow state survives.
// On success the credit store updates via the webhook->grant broadcast;
// the modal shows a confirmation and closes.
//
// Sibling-overlay pattern (dim + panel as siblings) per the canonical
// dialogs (TemplateDeleteConfirmDialog et al).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { BillingSection } from "@/components/billing/BillingSection";
import { EmbeddedCheckout } from "@/components/billing/EmbeddedCheckout";
import { CheckoutBoundary } from "@/components/billing/CheckoutBoundary";
import { planLabel, type KnownPlan } from "@/lib/plan";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

export function UpgradeModal({
  open,
  onClose,
  // The tier that gates whatever the user clicked - renders the
  // contextual "requires {tier}" hint under the title.
  requiredTier,
  // Jump straight to the checkout step for a known price (the credit
  // gate's "buy the covering top-up pack" path).
  initialLookupKey = null,
  // Contextual headline when opened from a credit / preset / flow / cap gate,
  // so the tiers modal explains WHY it opened (replaces the old intermediate
  // CreditGateDialog card). Shown only on the plans step.
  gateContext = null,
  // Optional: fires the instant the checkout succeeds (the success step is
  // shown). The teaser paywall uses it to auto-fire the comped unlock right
  // after subscribe. Existing callers omit it - the modal behaves as before.
  onSuccess,
  // One-time unlock of THIS deck (2026-10-08): a card above the plans
  // ("just this presentation, one payment, nothing renews"). Its checkout
  // is opened by deck; the server prices it by the deck's size.
  deckUnlock = null,
}: {
  deckUnlock?: { projectId: string; priceCents: number } | null;
  open: boolean;
  onClose: () => void;
  requiredTier?: KnownPlan | null;
  initialLookupKey?: string | null;
  gateContext?: { title: string; body: string } | null;
  onSuccess?: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.components.upgradeModal;
  // null = plans step; a lookupKey = checkout step; "done" = success.
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  // Fresh steps every open — adjust during render (React's "reset state when a
  // prop changes" pattern) instead of an effect, so it can't cascade. The guard
  // runs the reset only on the closed→open transition.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLookupKey(initialLookupKey);
      setDone(false);
    }
  }

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
            key="upgrade-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={onClose}
            className="modal-dim fixed inset-0 z-[1200]"
          />

          <div
            key="upgrade-wrapper"
            className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4"
          >
            <motion.div
              ref={panelRef}
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="upgrade-modal-title"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              // Success step shrinks to the standard dialog width
              // (max-w-md, same as the other confirm modals); the
              // plans/checkout steps need the wide panel.
              className={`surface-modal pointer-events-auto flex max-h-[90vh] w-full flex-col rounded-2xl ${
                done ? "max-w-md" : "max-w-6xl"
              }`}
            >
              {/* Header row: title + contextual hint + close. */}
              <div className="flex items-start justify-between gap-3 px-4 pt-7 md:px-8">
                <div>
                  <h3 id="upgrade-modal-title" className="text-xl font-bold text-foreground">
                    {done
                      ? t.successTitle
                      : lookupKey
                        ? lookupKey === DECK_UNLOCK_KEY
                          ? t.deckUnlockTitle
                          : t.checkoutTitle
                        : gateContext
                          ? gateContext.title
                          : t.title}
                  </h3>
                  {!done && !lookupKey && gateContext ? (
                    <p className="mt-1 text-sm text-muted">{gateContext.body}</p>
                  ) : !done && !lookupKey && requiredTier ? (
                    <p className="mt-1 text-sm text-muted">
                      {t.requiresTier.replace(
                        "{tier}",
                        planLabel(dict.components.planUsage, requiredTier),
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  {lookupKey && !done && !initialLookupKey ? (
                    <button
                      type="button"
                      onClick={() => setLookupKey(null)}
                      className="btn-pill px-4 py-2 text-sm"
                    >
                      {t.back}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={dict.common.cancel}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-overlay-soft hover:text-foreground"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
              </div>

              {/* Body - scrolls when the cards overflow short screens. */}
              <div className="overflow-y-auto px-4 pb-8 pt-6 md:px-8">
                {done ? (
                  <div className="flex flex-col items-center gap-4 py-12 text-center">
                    <span
                      className="material-symbols-outlined text-[var(--tq-status-ok-dot)]"
                      style={{ fontSize: 56 }}
                      aria-hidden
                    >
                      check_circle
                    </span>
                    <p className="text-sm text-muted">
                      {lookupKey === DECK_UNLOCK_KEY ? t.deckUnlockSuccess : t.successBody}
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="btn-gradient px-8 py-2.5 text-sm"
                    >
                      {t.done}
                    </button>
                  </div>
                ) : lookupKey ? (
                  <CheckoutBoundary where="upgrade-modal-checkout">
                    <EmbeddedCheckout
                      lookupKey={lookupKey}
                      projectId={
                        lookupKey === DECK_UNLOCK_KEY ? deckUnlock?.projectId : undefined
                      }
                      onSuccess={() => {
                        setDone(true);
                        onSuccess?.();
                      }}
                    />
                  </CheckoutBoundary>
                ) : (
                  <CheckoutBoundary where="upgrade-modal-plans">
                    {deckUnlock ? (
                      <DeckUnlockOffer
                        priceCents={deckUnlock.priceCents}
                        onBuy={() => setLookupKey(DECK_UNLOCK_KEY)}
                      />
                    ) : null}
                    <BillingSection variant="modal" minTier={requiredTier} onBuy={(key) => setLookupKey(key)} />
                  </CheckoutBoundary>
                )}
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// Sentinel "price" for the one-time deck unlock step (the real price is
// chosen server-side from the deck).
const DECK_UNLOCK_KEY = "deck_unlock";

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "Just this presentation": one payment, no subscription, nothing renews. */
function DeckUnlockOffer({ priceCents, onBuy }: { priceCents: number; onBuy: () => void }) {
  const t = useDict().components.upgradeModal;
  const price = formatUsd(priceCents);
  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="surface-card flex flex-col gap-4 rounded-2xl border-2 border-[var(--tq-brand-blue)] p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="text-lg font-bold text-foreground">{t.deckUnlockTitle}</h4>
            <span className="text-2xl font-bold text-foreground" dir="ltr">
              {price}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--tq-brand-blue)]">{t.deckUnlockOnce}</p>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {t.deckUnlockPoints.map((point: string) => (
              <li key={point} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-[var(--tq-status-ok-dot)]" aria-hidden>
                  check
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" onClick={onBuy} className="btn-gradient shrink-0 px-6 py-3 text-sm">
          {t.deckUnlockCta.replace("{price}", price)}
        </button>
      </div>
      <p className="text-center text-sm font-semibold text-foreground">{t.deckUnlockOr}</p>
    </div>
  );
}
