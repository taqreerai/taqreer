// Canonical subscription-plan vocabulary.
//
// `User.plan` is a free-text String column ("free" by default). These
// helpers narrow + classify it so callers don't re-declare the literal
// union (it lived duplicated in the dashboard page + /api/usage/plan).

export const KNOWN_PLANS = ["free", "plus", "pro"] as const;
export type KnownPlan = (typeof KNOWN_PLANS)[number];

export function isKnownPlan(plan: string): plan is KnownPlan {
  return (KNOWN_PLANS as readonly string[]).includes(plan);
}

/** Coerce an arbitrary stored plan to a known plan ("free" fallback). */
export function normalizePlan(plan: string | null | undefined): KnownPlan {
  return plan && isKnownPlan(plan) ? plan : "free";
}

/**
 * Whether a plan may use premium templates. Reserved for the top "pro"
 * tier (product decision 2026-05-29). Centralized so the gate threshold
 * lives in one place if it later widens to include "plus".
 */
export function isProPlan(plan: string | null | undefined): boolean {
  return normalizePlan(plan) === "pro";
}
