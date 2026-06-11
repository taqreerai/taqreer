// Stripe price catalog - the single source mapping our tiers/packs to
// Stripe Products + Prices (billing plan Phase B). Server-only.
//
// We never hardcode Stripe IDs. Each Price carries a stable
// `lookup_key` we control and `metadata` describing what it grants;
// the checkout route resolves a Price by lookup_key at runtime, and the
// webhook maps a Price back to a grant by reading its metadata. So the
// scripts/stripe-setup-products.ts run is the ONLY place that touches
// Stripe IDs, and rotating/recreating products never requires a code
// change here.
//
// Amounts are in the smallest currency unit (cents). Subscription
// amounts mirror context/subscriptionmodel.md (monthly) + the landing's
// ~10%-off yearly (per-month × 12). Top-up amounts mirror TOPUP_PACKS.

import { TIERS, TOPUP_PACKS } from "@/lib/credits/cost";
import { KNOWN_PLANS, type KnownPlan } from "@/lib/plan";

export type BillingCadence = "monthly" | "yearly";

// What a paid Stripe Price represents on OUR side - the discriminated
// shape the webhook resolves from price.metadata.
export type PriceGrant =
  | { kind: "subscription"; plan: KnownPlan; cadence: BillingCadence }
  | { kind: "topup"; credits: number };

export type PriceSpec = {
  lookupKey: string;
  // Stripe Product this Price hangs off (one product per tier / pack).
  productKey: string;
  productName: string;
  amount: number; // cents
  currency: "usd";
  // Recurring interval for subscriptions; undefined = one-time (top-up).
  interval?: "month" | "year";
  // Mirrored onto BOTH the Stripe Product and Price metadata so the
  // webhook can resolve a grant from either object.
  grant: PriceGrant;
};

// Per-month price (cents) when billed YEARLY - the landing's ~10%-off
// figures. The yearly Stripe Price charges interval=year at ×12.
const YEARLY_PER_MONTH_USD: Record<"plus" | "pro" | "max", number> = {
  plus: 13,
  pro: 27,
  max: 63,
};

const PAID_PLANS = KNOWN_PLANS.filter(
  (p): p is "plus" | "pro" | "max" => p !== "free",
);

export const BILLING_CATALOG: readonly PriceSpec[] = [
  // Subscriptions - monthly + yearly per paid tier.
  ...PAID_PLANS.flatMap((plan): PriceSpec[] => {
    const productKey = `tier_${plan}`;
    const productName = `Taqreer ${plan[0].toUpperCase()}${plan.slice(1)}`;
    return [
      {
        lookupKey: `tier_${plan}_monthly`,
        productKey,
        productName,
        amount: TIERS[plan].priceUsd * 100,
        currency: "usd",
        interval: "month",
        grant: { kind: "subscription", plan, cadence: "monthly" },
      },
      {
        lookupKey: `tier_${plan}_yearly`,
        productKey,
        productName,
        amount: YEARLY_PER_MONTH_USD[plan] * 12 * 100,
        currency: "usd",
        interval: "year",
        grant: { kind: "subscription", plan, cadence: "yearly" },
      },
    ];
  }),
  // Top-up packs - one-time.
  ...TOPUP_PACKS.map((pack): PriceSpec => ({
    lookupKey: `topup_${pack.key}`,
    productKey: `topup_${pack.key}`,
    productName: `Taqreer ${pack.credits.toLocaleString("en-US")} credits`,
    amount: pack.priceUsd * 100,
    currency: "usd",
    grant: { kind: "topup", credits: pack.credits },
  })),
];

export function specByLookupKey(lookupKey: string): PriceSpec | undefined {
  return BILLING_CATALOG.find((s) => s.lookupKey === lookupKey);
}

// Flatten a grant to string metadata (Stripe metadata values are
// strings). The webhook reverses this via parseGrantMetadata.
export function grantToMetadata(grant: PriceGrant): Record<string, string> {
  return grant.kind === "subscription"
    ? { grantKind: "subscription", plan: grant.plan, cadence: grant.cadence }
    : { grantKind: "topup", credits: String(grant.credits) };
}

export function parseGrantMetadata(
  metadata: Record<string, string> | null | undefined,
): PriceGrant | null {
  if (!metadata) return null;
  if (metadata.grantKind === "subscription") {
    const plan = metadata.plan;
    const cadence = metadata.cadence;
    if (
      (KNOWN_PLANS as readonly string[]).includes(plan) &&
      (cadence === "monthly" || cadence === "yearly")
    ) {
      return { kind: "subscription", plan: plan as KnownPlan, cadence };
    }
    return null;
  }
  if (metadata.grantKind === "topup") {
    const credits = Number(metadata.credits);
    if (Number.isInteger(credits) && credits > 0) {
      return { kind: "topup", credits };
    }
  }
  return null;
}
