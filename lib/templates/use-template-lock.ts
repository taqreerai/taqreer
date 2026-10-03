"use client";

// One answer to "can this viewer generate with this template?" (2026-10-02),
// shared by every template surface (dashboard + /templates tiles and
// lightboxes, the /create Design step) so the crowns never disagree.
// Mirrors the server gates, which stay authoritative:
//   - the template flow ("mimic") is Plus+ (tier `flows`), EXCEPT curator
//     free-plan templates (Template.isFree; POST /api/projects), and
//   - premium templates need Pro+ (owners pass; POST /api/templates/[id]/use).
// Admins pass everything. Null until /api/credits resolves, so a paying user
// never sees a lock flash in.

import { useCallback } from "react";
import { useCreditBalance, useFlowUnlockTier } from "@/lib/credits/store";
import { isProPlan, normalizePlan, type KnownPlan } from "@/lib/plan";

export type LockableTemplate = {
  isMine: boolean;
  isPremium?: boolean;
  isFree?: boolean;
};

export function useTemplateLock() {
  const credits = useCreditBalance();
  const flowTier = useFlowUnlockTier("mimic");
  // True when the viewer's plan can't run templates at all (free plan): the
  // free-plan templates then carry the "free" badge.
  const flowLocked = !!flowTier && !credits?.isAdmin;

  const lockFor = useCallback(
    (tpl: LockableTemplate): KnownPlan | null => {
      if (!credits || credits.isAdmin) return null;
      if (flowTier && !tpl.isFree) return normalizePlan(flowTier);
      if (tpl.isPremium && !tpl.isMine && !isProPlan(credits.plan)) return "pro";
      return null;
    },
    [credits, flowTier],
  );

  /** True when the lock comes from the premium gate, not the plan's flows. */
  const isPremiumLock = useCallback(
    (tpl: LockableTemplate) =>
      !!credits &&
      !credits.isAdmin &&
      !(flowTier && !tpl.isFree) &&
      !!tpl.isPremium &&
      !tpl.isMine &&
      !isProPlan(credits.plan),
    [credits, flowTier],
  );

  return { lockFor, isPremiumLock, flowLocked };
}
