"use client";

// AIImagesPanel — the "Generate images" toggle (create: lives inside the
// content card; social/mimic: in their output/reference cards). An image icon
// in a brand-violet tile on the reading edge, title + one-line subtitle, and
// the Toggle on the far edge. The violet wash + border make it read as a
// feature, not a row of fine print.
//
// Open to every plan since 2026-10-04 (free accounts pay 0 credits per image
// and see a "free on your trial" pill). The gate lives IN this component so all three
// flows inherit it with zero per-flow wiring: a locked user sees a gold crown
// and their enable click opens the UpgradeModal instead of flipping the
// toggle — the Toggle stays controlled by the parent value, so nothing
// flickers. Only ENABLES are gated: a stale-true value (mid-session
// downgrade) can always be turned off. Server backstop: preflightGenerate's
// `images_locked` 402 catches direct POSTs.

import { useState } from "react";
import { Toggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { isImagesLocked, IMAGES_GATE_TIER } from "@/lib/images/images-gating";
import { isPaidPlan, planLabel } from "@/lib/plan";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { PremiumCrown } from "@/components/billing/PremiumCrown";

export function AIImagesPanel({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const credits = useCreditBalance();
  // null plan (still hydrating) gates like free — the toggle defaults OFF, so
  // a paying user's pre-hydration state is just "crown for a beat", never a
  // wrongly-blocked enabled state (lib/images/images-gating.ts).
  const locked = isImagesLocked({
    plan: credits?.plan ?? null,
    isAdmin: credits?.isAdmin ?? false,
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Free accounts: images cost them 0 credits (lib/images/images-gating).
  const freeTrialPerk =
    credits !== null && !credits.isAdmin && !isPaidPlan(credits.plan);

  const handleChange = (next: boolean) => {
    if (locked && next) {
      setUpgradeOpen(true);
      return;
    }
    onChange(next);
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
        value
          ? "border-[var(--tq-violet)]/50 bg-[var(--tq-violet)]/15"
          : "border-[var(--tq-violet)]/25 bg-[var(--tq-violet)]/8"
      }`}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--tq-violet)]/25 text-[var(--tq-violet)]"
        aria-hidden
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          image
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {dict.flows.brand.aiImagesTitle}
          {locked ? (
            // Gold crown = paid feature (ExportMenu's affordance).
            <PremiumCrown size={14} />
          ) : null}
          {freeTrialPerk ? (
            <span className="rounded-full bg-[var(--tq-violet)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--tq-violet)]">
              {dict.flows.brand.aiImagesFreeHint}
            </span>
          ) : null}
        </span>
        <span className="block text-[11px] text-foreground/55">
          {dict.flows.brand.aiImagesDesc}
        </span>
      </div>
      <Toggle
        ariaLabel={dict.flows.brand.aiImagesTitle}
        value={value}
        onChange={handleChange}
        disabled={disabled}
      />
      <UpgradeModal
        open={upgradeOpen}
        gateContext={{
          title: dict.components.creditGate.imagesLockedTitle,
          body: `${dict.components.creditGate.imagesLockedBody.replace(
            "{tier}",
            planLabel(dict.components.planUsage, IMAGES_GATE_TIER),
          )} ${dict.components.creditGate.chooseTier}`.trim(),
        }}
        onClose={() => setUpgradeOpen(false)}
      />
    </div>
  );
}
