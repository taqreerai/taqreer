"use client";

// One answer to "can this viewer generate with this template?" (2026-10-02),
// shared by every template surface (dashboard + /templates tiles and
// lightboxes, the /create Design step) so the crowns never disagree.
// Mirrors the server gates, which stay authoritative:
//   - the template flow ("mimic") is Plus+ (tier `flows`), EXCEPT curator
//     free-plan templates (Template.isFree; POST /api/projects), and
//   - premium templates need Pro+ (owners pass; POST /api/templates/[id]/use).
// Admins pass everything. Null until /api/credits resolves, so a paying user
// never sees a lock flash in. A signed-out visitor on /create (2026-10-06)
// has no balance: they are shown what a new free account gets (every flow is
// open to free since 2026-10-05), so only premium templates carry the crown.

import { useCallback } from "react";
import { useCreditBalance, useFlowUnlockTier } from "@/lib/credits/store";
import { isProPlan, normalizePlan, type KnownPlan } from "@/lib/plan";
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
      if (guest) return tpl.isPremium ? "pro" : null;
      if (!credits || credits.isAdmin) return null;
      if (flowTier && !tpl.isFree) return normalizePlan(flowTier);
      if (tpl.isPremium && !tpl.isMine && !isProPlan(credits.plan)) return "pro";
      return null;
    },
    [credits, flowTier, guest],
  );

  /** True when the lock comes from the premium gate, not the plan's flows. */
  const isPremiumLock = useCallback(
    (tpl: LockableTemplate) =>
      (guest && !!tpl.isPremium) ||
      (!!credits &&
      !credits.isAdmin &&
      !(flowTier && !tpl.isFree) &&
      !!tpl.isPremium &&
      !tpl.isMine &&
      !isProPlan(credits.plan)),
    [credits, flowTier, guest],
  );

  return { lockFor, isPremiumLock, flowLocked };
}
