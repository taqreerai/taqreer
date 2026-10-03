"use client";

// Small upsell popover for the free-plan watermark (2026-10-03). Opens right
// next to the "Made with taqreer.ai" badge (or the branded closing slide) the
// moment a free user clicks it, at peak intent: one headline, three concrete
// gains, and a single primary button that drops straight into Plus checkout
// at the LIVE monthly price (UpgradeModal initialLookupKey), plus the cheaper
// yearly option and "all plans" as quieter escapes. Outside click / Esc
// closes it without nagging.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { PremiumCrown } from "@/components/billing/PremiumCrown";
import { useCreditBalance } from "@/lib/credits/store";
import { TIERS } from "@/lib/credits/cost";
import { YEARLY_PER_MONTH_USD } from "@/lib/billing/prices";

const WIDTH = 316;
const GAP = 10;
const EDGE = 12;

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function WatermarkUpsellPopover({
  anchor,
  onClose,
}: {
  // The clicked element's viewport rect; null = closed.
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.components.watermarkUpsell;
  const credits = useCreditBalance();
  const plus = credits?.tierPrices?.find((p) => p.plan === "plus");
  const monthly = plus?.monthly || TIERS.plus.priceUsd;
  const yearly = plus?.yearly || YEARLY_PER_MONTH_USD.plus;
  // A chosen price opens the checkout modal (the popover closes under it).
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anchor, onClose]);

  if (typeof document === "undefined") return null;

  // Open above the anchor (the badge sits at the slide's bottom edge), aligned
  // to whichever side of the screen the anchor is on; clamped to the viewport.
  let pos: { left: number; top?: number; bottom?: number } = { left: 0 };
  if (anchor) {
    const center = anchor.left + anchor.width / 2;
    const rawLeft =
      center < window.innerWidth / 2 ? anchor.left : anchor.right - WIDTH;
    const left = Math.max(EDGE, Math.min(rawLeft, window.innerWidth - WIDTH - EDGE));
    pos =
      anchor.top > 300
        ? { left, bottom: window.innerHeight - anchor.top + GAP }
        : { left, top: anchor.bottom + GAP };
  }
  const flipUp = pos.bottom !== undefined;

  const go = (key: string) => {
    setCheckoutKey(key);
    onClose();
  };

  return (
    <>
      {createPortal(
        <>
          {anchor ? (
            <div className="fixed inset-0 z-[1199]" aria-hidden onMouseDown={onClose} />
          ) : null}
          <AnimatePresence>
            {anchor ? (
              <motion.div
                key="wm-upsell"
                dir={dir}
                role="dialog"
                aria-label={t.title}
                initial={{ opacity: 0, y: flipUp ? 8 : -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: flipUp ? 8 : -8, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="surface-popover wm-upsell fixed z-[1200] overflow-hidden rounded-2xl p-4"
                style={{ ...pos, width: WIDTH }}
              >
                <div className="flex items-start gap-3">
                  <span className="premium-banner-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                    <PremiumCrown size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug text-foreground">{t.title}</p>
                    <p className="mt-1 text-xs leading-5 text-foreground/65">{t.body}</p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {t.perks.map((perk: string) => (
                    <li key={perk} className="flex items-center gap-2 text-xs text-foreground/85">
                      <span
                        className="material-symbols-outlined text-[var(--tq-brand-blue)]"
                        style={{ fontSize: 16 }}
                        aria-hidden
                      >
                        check_circle
                      </span>
                      {perk}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => go("tier_plus_monthly")}
                  className="wm-upsell-cta mt-4 w-full rounded-xl py-2.5 text-sm font-semibold"
                >
                  {t.cta.replace("{price}", money(monthly))}
                </button>
                <button
                  type="button"
                  onClick={() => go("tier_plus_yearly")}
                  className="mt-2 w-full text-center text-xs font-medium text-[var(--tq-brand-blue)] hover:underline"
                >
                  {t.yearly.replace("{price}", money(yearly))}
                </button>
                <div className="mt-3 flex items-center justify-between border-t border-foreground/[0.08] pt-2.5 text-[11px] text-foreground/50">
                  <span>{t.reassure}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPlansOpen(true);
                      onClose();
                    }}
                    className="font-medium text-foreground/70 hover:text-foreground"
                  >
                    {t.allPlans}
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>,
        document.body,
      )}
      <UpgradeModal
        open={checkoutKey != null || plansOpen}
        requiredTier="plus"
        initialLookupKey={checkoutKey}
        gateContext={{
          title: dict.components.creditGate.watermarkTitle,
          body: dict.components.creditGate.watermarkBody,
        }}
        onClose={() => {
          setCheckoutKey(null);
          setPlansOpen(false);
        }}
      />
    </>
  );
}
