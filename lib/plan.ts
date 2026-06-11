// Canonical subscription-plan vocabulary.
//
// `User.plan` is a free-text String column ("free" by default). These
// helpers narrow + classify it so callers don't re-declare the literal
// union (it lived duplicated in the dashboard page + /api/usage/plan).

export const KNOWN_PLANS = ["free", "plus", "pro", "max"] as const;
export type KnownPlan = (typeof KNOWN_PLANS)[number];

export function isKnownPlan(plan: string): plan is KnownPlan {
  return (KNOWN_PLANS as readonly string[]).includes(plan);
}

/** Coerce an arbitrary stored plan to a known plan ("free" fallback). */
export function normalizePlan(plan: string | null | undefined): KnownPlan {
  return plan && isKnownPlan(plan) ? plan : "free";
}

/**
 * Whether a plan may use premium templates. The top TWO tiers (user
 * direction 2026-06-11: "premium templates, open only for pro and
 * max"), matching the subscriptionmodel.md capability table.
 * Centralized so the gate threshold lives in one place. Curation of
 * WHICH templates are premium happens in the future admin panel
 * (Template.isPremium already exists in the schema).
 */
export function isProPlan(plan: string | null | undefined): boolean {
  const p = normalizePlan(plan);
  return p === "pro" || p === "max";
}
