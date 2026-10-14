"use client";

// One answer to "can this viewer generate with this template?" (2026-10-02),
// shared by every template surface (dashboard + /templates tiles and
// lightboxes, the /create Design step) so the crowns never disagree.
// Mirrors the server gate, which stays authoritative: the template flow
// ("mimic") is Plus+ (tier `flows`), EXCEPT curator free-plan templates
// (Template.isFree; POST /api/projects). Premium templates are open to every
// plan since 2026-10-14, so `isPremium` no longer locks anything. Admins pass
// everything. Null until /api/credits resolves, so a paying user never sees a
// lock flash in.

import { useCallback } from "react";
import { useCreditBalance, useFlowUnlockTier } from "@/lib/credits/store";
import { normalizePlan, type KnownPlan } from "@/lib/plan";
import { useIsGuest } from "@/components/app/GuestContext";

export type LockableTemplate = {
  isMine: boolean;
  isPremium?: boolean;
  isFree?: boolean;
};

export function useTemplateLock() {
  const credits = useCreditBalance();
  const flowTier = useFlowUnlockTier("mimic");
  const guest = useIsGuest();
  // True when the viewer's plan can't run templates at all (free plan): the
  // free-plan templates then carry the "free" badge.
  const flowLocked = !guest && !!flowTier && !credits?.isAdmin;

  const lockFor = useCallback(
    (tpl: LockableTemplate): KnownPlan | null => {
      if (guest || !credits || credits.isAdmin) return null;
      if (flowTier && !tpl.isFree) return normalizePlan(flowTier);
      return null;
    },
    [credits, flowTier, guest],
  );

  /** Premium templates are no longer gated (2026-10-14): never a premium lock. */
  const isPremiumLock = useCallback((tpl: LockableTemplate) => {
    void tpl;
    return false;
  }, []);

  return { lockFor, isPremiumLock, flowLocked };
}
