// Shared "why the upgrade modal opened" contexts (2026-10-18), so the callout
// reads the same wherever a gate is hit. Pure helpers: callers pass their dict.

import type { Dictionary } from "@/lib/i18n/dictionaries";
import { IMAGES_GATE_TIER } from "@/lib/images/images-gating";
import { planLabel, type KnownPlan } from "@/lib/plan";
import type { GateContext } from "@/components/billing/UpgradeModal";

/** Generated images are locked (AIImagesPanel, the social product-photo gate, the 402 images_locked). */
export function imagesGateContext(dict: Dictionary): GateContext {
  const t = dict.components.creditGate;
  const tier = planLabel(dict.components.planUsage, IMAGES_GATE_TIER);
  return {
    title: t.imagesLockedTitle.replace("{tier}", tier),
    body: t.imagesLockedBody.replace("{tier}", tier),
    icon: "image",
    tier: IMAGES_GATE_TIER,
    feature: "images",
  };
}

/** AI edits after generation are a paid feature. */
export function aiEditGateContext(dict: Dictionary, tierKey: KnownPlan): GateContext {
  const t = dict.components.creditGate;
  const tier = planLabel(dict.components.planUsage, tierKey);
  return {
    title: t.aiEditLockedTitle.replace("{tier}", tier),
    body: t.aiEditLockedBody.replace("{tier}", tier),
    icon: "auto_fix_high",
    tier: tierKey,
    feature: "aiEdit",
  };
}
