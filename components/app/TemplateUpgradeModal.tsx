"use client";

// The upgrade prompt for a locked template (2026-10-02), shared by the
// dashboard + /templates lightboxes and the /create Design step so every
// surface explains the same gate the same way (lib/templates/use-template-lock).

import { useDict } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { planLabel, type KnownPlan } from "@/lib/plan";

export type TemplateGate = { tier: KnownPlan; premium: boolean } | null;

export function TemplateUpgradeModal({
  gate,
  onClose,
}: {
  gate: TemplateGate;
  onClose: () => void;
}) {
  const dict = useDict();
  const t = dict.flows.design;
  const label = gate ? planLabel(dict.components.planUsage, gate.tier) : "";
  return (
    <UpgradeModal
      open={gate != null}
      requiredTier={gate?.tier ?? null}
      gateContext={
        gate
          ? {
              title: (gate.premium ? t.premiumTitle : t.lockedTitle).replace("{tier}", label),
              body: (gate.premium ? t.premiumBody : t.lockedBody).replace("{tier}", label),
              icon: "workspace_premium",
              tier: gate.tier,
            }
          : null
      }
      onClose={onClose}
    />
  );
}
