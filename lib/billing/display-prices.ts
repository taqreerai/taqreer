// Live tier prices for the pricing surfaces, read straight from Stripe by the
// stable lookup_keys (the SAME Prices checkout charges), so a card can never
// advertise a number we don't actually bill. Monthly = the monthly Price's
// unit_amount; "yearly" here is the PER-MONTH figure (the yearly Stripe Price is
// the annual total, so /12). Server-only.
//
// Cached in-process (prices change rarely + deliberately) and FAIL-SOFT: any
// Stripe error / missing Price falls back to the BILLING_CATALOG amounts (what
// the Stripe products were seeded from), so a Stripe blip never breaks the
// force-static marketing build or /api/credits.
import { BILLING_CATALOG } from "@/lib/billing/prices";

export type TierPrice = { plan: string; monthly: number; yearly: number };

const SUB_SPECS = BILLING_CATALOG.filter((s) => s.grant.kind === "subscription");

// Fallback: the catalog amounts the Stripe products were created from.
function catalogPrices(): TierPrice[] {
  const byPlan = new Map<string, { monthly: number; yearly: number }>();
  for (const s of SUB_SPECS) {
    if (s.grant.kind !== "subscription") continue;
    const cur = byPlan.get(s.grant.plan) ?? { monthly: 0, yearly: 0 };
    if (s.grant.cadence === "monthly") cur.monthly = s.amount / 100;
    else cur.yearly = s.amount / 12 / 100;
    byPlan.set(s.grant.plan, cur);
  }
  return [
    { plan: "free", monthly: 0, yearly: 0 },
    ...[...byPlan].map(([plan, v]) => ({ plan, ...v })),
  ];
}

let cache: { at: number; data: TierPrice[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Drop the cached prices so the next read re-fetches (after a Stripe change). */
export function invalidateDisplayPrices(): void {
  cache = null;
}

export async function getDisplayPrices(): Promise<TierPrice[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  // No Stripe key (a keyless CI / contributor / preview build): never load the
  // throwing stripe module - show the catalog. Keeps the fail-soft promise that
  // missing or broken Stripe never breaks the force-static marketing build.
  if (!process.env.STRIPE_SECRET_KEY) {
    const data = catalogPrices();
    cache = { at: Date.now(), data };
    return data;
  }
  let data: TierPrice[];
  try {
    // Lazy import: stripe.ts throws at module load without the key, so loading
    // it INSIDE the try lets the catch below fail-soft instead of breaking build.
    const { stripe } = await import("@/lib/billing/stripe");
    const res = await stripe.prices.list({
      lookup_keys: SUB_SPECS.map((s) => s.lookupKey),
      active: true,
      limit: 100,
    });
    const byPlan = new Map<string, { monthly: number; yearly: number }>();
    for (const spec of SUB_SPECS) {
      if (spec.grant.kind !== "subscription") continue;
      const p = res.data.find((d) => d.lookup_key === spec.lookupKey);
      if (!p || p.unit_amount == null) continue;
      const cur = byPlan.get(spec.grant.plan) ?? { monthly: 0, yearly: 0 };
      if (spec.grant.cadence === "monthly") cur.monthly = p.unit_amount / 100;
      else cur.yearly = p.unit_amount / 12 / 100;
      byPlan.set(spec.grant.plan, cur);
    }
    const live: TierPrice[] = [
      { plan: "free", monthly: 0, yearly: 0 },
      ...[...byPlan].map(([plan, v]) => ({ plan, ...v })),
    ];
    // Only trust the live set if EVERY catalog paid tier resolved BOTH cadences
    // to a positive price; otherwise show the catalog (never a partial / zero /
    // missing-tier price). Derived from the catalog so it scales if a tier is added.
    const expectedPlans = new Set<string>();
    for (const s of SUB_SPECS) {
      if (s.grant.kind === "subscription") expectedPlans.add(s.grant.plan);
    }
    const complete = [...expectedPlans].every((plan) => {
      const v = byPlan.get(plan);
      return !!v && v.monthly > 0 && v.yearly > 0;
    });
    data = complete ? live : catalogPrices();
  } catch (err) {
    console.error("[display-prices] Stripe fetch failed, using catalog", err);
    data = catalogPrices();
  }
  cache = { at: Date.now(), data };
  return data;
}

/** Look up a plan's prices, tolerating an absent list. */
export function tierPriceFor(
  list: readonly TierPrice[] | undefined,
  plan: string,
): TierPrice | undefined {
  return list?.find((t) => t.plan === plan);
}

// ─── Top-up packs (same live-from-Stripe + catalog-fallback contract) ──
// The packs the billing UI renders: credits from the Price's grant
// metadata mirror in the catalog, price from Stripe by lookup_key. A
// pack whose live Price is missing/zero falls back to its catalog
// amount, so the four cards always render and never show $0.

export type TopupDisplayPack = { key: string; credits: number; priceUsd: number };

const TOPUP_SPECS = BILLING_CATALOG.filter((s) => s.grant.kind === "topup");

function catalogTopupPacks(): TopupDisplayPack[] {
  return TOPUP_SPECS.map((s) => ({
    key: s.lookupKey.replace(/^topup_/, ""),
    credits: s.grant.kind === "topup" ? s.grant.credits : 0,
    priceUsd: s.amount / 100,
  }));
}

let topupCache: { at: number; data: TopupDisplayPack[] } | null = null;

/** Drop the cached packs so the next read re-fetches (after a Stripe change). */
export function invalidateTopupDisplayPacks(): void {
  topupCache = null;
}

export async function getTopupDisplayPacks(): Promise<TopupDisplayPack[]> {
  if (topupCache && Date.now() - topupCache.at < TTL_MS) return topupCache.data;
  if (!process.env.STRIPE_SECRET_KEY) {
    const data = catalogTopupPacks();
    topupCache = { at: Date.now(), data };
    return data;
  }
  let data: TopupDisplayPack[];
  try {
    const { stripe } = await import("@/lib/billing/stripe");
    const res = await stripe.prices.list({
      lookup_keys: TOPUP_SPECS.map((s) => s.lookupKey),
      active: true,
      limit: 100,
    });
    data = TOPUP_SPECS.map((spec) => {
      const p = res.data.find((d) => d.lookup_key === spec.lookupKey);
      const live = p?.unit_amount != null && p.unit_amount > 0 ? p.unit_amount : null;
      return {
        key: spec.lookupKey.replace(/^topup_/, ""),
        credits: spec.grant.kind === "topup" ? spec.grant.credits : 0,
        priceUsd: (live ?? spec.amount) / 100,
      };
    });
  } catch (err) {
    console.error("[display-prices] Stripe top-up fetch failed, using catalog", err);
    data = catalogTopupPacks();
  }
  topupCache = { at: Date.now(), data };
  return data;
}
