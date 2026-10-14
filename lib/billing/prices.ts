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
// amounts mirror TIERS (monthly) + a uniform 15%-off yearly base
// (promo codes can top yearly up to 25% total; per-month × 12; 2026-07
// repricing). Top-up amounts mirror TOPUP_PACKS.

import { TIERS, TOPUP_PACKS } from "@/lib/credits/cost";
import { KNOWN_PLANS, type KnownPlan } from "@/lib/plan";
import {
  DECK_UNLOCK_BRACKETS,
  deckUnlockLookupKey,
  REGIONAL_DECK_UNLOCK_CENTS,
  type DeckUnlockBracket,
} from "@/lib/billing/deck-unlock-brackets";

export type BillingCadence = "monthly" | "yearly";

// What a paid Stripe Price represents on OUR side - the discriminated
// shape the webhook resolves from price.metadata.
export type PriceGrant =
  | { kind: "subscription"; plan: KnownPlan; cadence: BillingCadence }
  | { kind: "topup"; credits: number }
  // One-time unlock of ONE teaser deck (2026-10-08). The deck's id rides the
  // Checkout Session metadata (projectId), never the price.
  | { kind: "deck_unlock"; bracket: DeckUnlockBracket };

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

// Per-month price (USD) when billed YEARLY - a uniform 15% off the
// monthly price (2026-07-28 reprice $9/$25/$79, was Gamma-parity $12/$25/$100; 15%
// base held, and promo codes top yearly up to 25% total - see the coupon
// guidance in app/api/stripe/checkout/route.ts). Fractional dollars
// are fine: the ×12×100 yearly amounts are integer cents
// (9180/25500/80580). The yearly Stripe Price charges interval=year
// at ×12.
export const YEARLY_PER_MONTH_USD: Record<"plus" | "pro" | "max", number> = {
  // 2026-10-02 (owner direction): yearly is the DEFAULT cadence, so its
  // per-month figure is a round number, rounded DOWN from the 15%-off base
  // (7.65 / 21.25 / 67.15): $7 / $21 / $67, billed $84 / $252 / $804 a year.
  // Savings vs monthly: Plus 22%, Pro 16%, Max 15%.
  // 2026-10-14 ladder $9 / $19 / $59: 15%-off base 7.65 / 16.15 / 50.15, rounded
  // DOWN to $7 / $16 / $50, billed $84 / $192 / $600 a year (Plus 22%, Pro 16%,
  // Max 15% below monthly).
  plus: 7,
  pro: 16,
  max: 50,
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
        // Rounded: the per-month figure is fractional dollars, and IEEE
        // floats make 7.65*12*100 = 9180.000000000002 - Stripe rejects a
        // non-integer unit_amount.
        amount: Math.round(YEARLY_PER_MONTH_USD[plan] * 12 * 100),
        currency: "usd",
        interval: "year",
        grant: { kind: "subscription", plan, cadence: "yearly" },
      },
    ];
  }),
  // One-time deck unlocks - $4.99 / $5.99 / $6.99 by deck size.
  ...DECK_UNLOCK_BRACKETS.map((b): PriceSpec => ({
    lookupKey: deckUnlockLookupKey(b.key),
    productKey: deckUnlockLookupKey(b.key),
    productName: `Taqreer presentation unlock (up to ${b.maxSlides} slides)`,
    amount: b.priceCents,
    currency: "usd",
    grant: { kind: "deck_unlock", bracket: b.key },
  })),
  // Regional one-time unlocks (region-limited free accounts), same grant.
  ...DECK_UNLOCK_BRACKETS.map((b): PriceSpec => ({
    lookupKey: deckUnlockLookupKey(b.key, true),
    productKey: deckUnlockLookupKey(b.key, true),
    productName: `Taqreer presentation unlock, regional (up to ${b.maxSlides} slides)`,
    amount: REGIONAL_DECK_UNLOCK_CENTS[b.key],
    currency: "usd",
    grant: { kind: "deck_unlock", bracket: b.key },
  })),
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
  if (grant.kind === "subscription") {
    return { grantKind: "subscription", plan: grant.plan, cadence: grant.cadence };
  }
  if (grant.kind === "deck_unlock") {
    return { grantKind: "deck_unlock", bracket: grant.bracket };
  }
  return { grantKind: "topup", credits: String(grant.credits) };
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
  if (metadata.grantKind === "deck_unlock") {
    const bracket = metadata.bracket;
    if (DECK_UNLOCK_BRACKETS.some((b) => b.key === bracket)) {
      return { kind: "deck_unlock", bracket: bracket as DeckUnlockBracket };
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
