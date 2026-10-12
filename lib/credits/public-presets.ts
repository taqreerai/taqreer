// The generation-preset payload the picker renders: active presets with their
// live (DB-driven) cost and the lowest tier that unlocks each. One builder for
// the signed-in payload (/api/credits) and the signed-out one (/api/presets),
// so both menus show exactly what the server will charge and gate on.

import { getActivePresets, getTier } from "@/lib/config/runtime-config";
import type { CreditPreset } from "@/lib/credits/store";

const TIER_ORDER = ["free", "plus", "pro", "max"] as const;

export function activePresetPayload(): CreditPreset[] {
  return getActivePresets().map((p) => ({
    key: p.key,
    label: p.label,
    thinking: p.thinking,
    effort: p.effort ?? null,
    baseCredits: p.baseCredits,
    perSlideCredits: p.perSlideCredits,
    gateTier:
      TIER_ORDER.find((plan) => getTier(plan).unlockedPresetKeys.includes(p.key)) ?? null,
  }));
}
