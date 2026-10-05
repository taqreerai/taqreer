"use client";

// One line under a slide-count control telling a Free user the cap up front
// ("Up to 5 slides on the Free plan") with an upgrade link (2026-10-01).
// Previously the stepper just stopped silently at the cap. Renders nothing
// for paid plans, admins, or before /api/credits resolves.

import { TEASER_VISIBLE_COUNT } from "@/lib/credits/cost";
import { useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { PremiumCrown } from "@/components/billing/PremiumCrown";
import { useCreditBalance } from "@/lib/credits/store";

export function SlideCapHint({ className = "" }: { className?: string }) {
  const dict = useDict();
  const t = dict.components.premiumGate;
  const credits = useCreditBalance();
  const [open, setOpen] = useState(false);
  if (!credits || credits.isAdmin || credits.plan !== "free") return null;

  return (
    <>
      <p className={`flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--tq-text-muted)] ${className}`}>
        <PremiumCrown size={13} />
        {/* Free trial: the teaser builds the first TEASER_VISIBLE_COUNT slides
            of any length; the rest unlock on subscribe. */}
        <span>{t.slideCapHint.replace("{count}", String(TEASER_VISIBLE_COUNT))}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-[var(--tq-violet)] underline-offset-2 hover:underline"
        >
          {t.upgrade}
        </button>
      </p>
      <UpgradeModal open={open} onClose={() => setOpen(false)} requiredTier="plus" />
    </>
  );
}
