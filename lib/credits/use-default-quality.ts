"use client";

// The generation level a create page starts on (2026-10-03, owner
// direction): paid accounts (and admins) whose plan unlocks the Opus level ("opus-fast",
// Opus 5.5) start there; free accounts keep the bundled default (Sonnet 5.5).
// A manual pick in the quality menu always wins. Derived during render from
// /api/credits (no effect), so it settles the moment credits resolve.

import { useState } from "react";
import { useCreditBalance } from "@/lib/credits/store";
import { TIER_ORDER } from "@/lib/credits/cost";
import { normalizePlan } from "@/lib/plan";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";

const PAID_DEFAULT: Quality = "opus-fast";

export function useDefaultQuality(): [Quality, (q: Quality) => void] {
  const credits = useCreditBalance();
  const [picked, setPicked] = useState<Quality | null>(null);
  let fallback: Quality = DEFAULT_QUALITY;
  const preset = credits?.presets?.find((p) => p.key === PAID_DEFAULT);
  if (credits && preset) {
    const plan = normalizePlan(credits.plan);
    const unlocked =
      credits.isAdmin ||
      (plan !== "free" &&
        preset.gateTier !== null &&
        TIER_ORDER.indexOf(plan) >= TIER_ORDER.indexOf(preset.gateTier));
    if (unlocked) fallback = PAID_DEFAULT;
  }
  return [picked ?? fallback, setPicked];
}
