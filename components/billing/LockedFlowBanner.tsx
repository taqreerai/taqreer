"use client";

// Upfront notice on a flow page the user's plan can't generate with
// (2026-10-01). Free users used to fill the whole form and only learn at
// Generate that the flow needs Plus; now the page opens with this banner, so
// they can still explore but know what to expect. Renders nothing for plans
// that include the flow (and until /api/credits resolves).

import { useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { PremiumCrown } from "@/components/billing/PremiumCrown";
import { useFlowUnlockTier } from "@/lib/credits/store";
import { normalizePlan, planLabel } from "@/lib/plan";

export function LockedFlowBanner({
  flow,
  className = "",
}: {
  flow: "enhance" | "mimic" | "social" | "datasheet";
  className?: string;
}) {
  const dict = useDict();
  const t = dict.components.premiumGate;
  const unlockTier = useFlowUnlockTier(flow);
  const [open, setOpen] = useState(false);
  if (!unlockTier) return null;

  const tier = planLabel(dict.components.planUsage, unlockTier);
  return (
    <>
      <div
        role="status"
        className={`premium-banner mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ${className}`}
      >
        <span className="premium-banner-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <PremiumCrown size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {t.lockedFlowTitle.replace("{tier}", tier)}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--tq-text-muted)]">
            {t.lockedFlowBody.replace("{tier}", tier)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-gradient shrink-0 rounded-full px-4 py-2 text-xs font-medium"
        >
          {t.upgrade}
        </button>
      </div>
      <UpgradeModal
        open={open}
        onClose={() => setOpen(false)}
        requiredTier={normalizePlan(unlockTier)}
      />
    </>
  );
}
