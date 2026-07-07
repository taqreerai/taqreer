// Fill {credits}/{slides} tokens in a pricing dict string with live config
// numbers. Latin numerals + thousands grouping (brand rule: "2,000", not Arabic
// digits). Pure + client-safe, so PricingTiers (marketing) and BillingSection
// (in-app) share it. A token with no value provided is left intact, so callers
// must always pass the relevant number for a surface that shows it.
export function fillPricingTokens(
  text: string,
  vals: { credits?: number | null; slides?: number | null },
): string {
  let out = text;
  if (vals.credits != null) {
    out = out.replaceAll("{credits}", vals.credits.toLocaleString("en-US"));
  }
  if (vals.slides != null) {
    out = out.replaceAll("{slides}", vals.slides.toLocaleString("en-US"));
    // Arabic counted-noun agreement (تمييز العدد): 3-10 take the plural شرائح,
    // 11+ the singular accusative شريحة. English pluralizes "slides" the same
    // for every value, so the EN template fixes its noun and only the Arabic
    // slide-cap string carries this {slidesNoun} token.
    out = out.replaceAll(
      "{slidesNoun}",
      vals.slides >= 3 && vals.slides <= 10 ? "شرائح" : "شريحة",
    );
  }
  return out;
}

/**
 * The yearly-billing discount % implied by the ACTUAL prices (monthly vs
 * per-month-when-yearly), so the "Save {pct}%" chip can never drift from
 * what Stripe charges. Uses the largest per-tier discount (uniform today;
 * max keeps the claim honest if they ever diverge). Null when no paid tier
 * has both cadences resolved - callers fall back or hide the chip.
 */
export function yearlyDiscountPct(
  tierPrices:
    | readonly { plan: string; monthly: number; yearly: number }[]
    | undefined,
): number | null {
  let best: number | null = null;
  for (const t of tierPrices ?? []) {
    if (t.monthly > 0 && t.yearly > 0 && t.yearly < t.monthly) {
      const pct = Math.round((1 - t.yearly / t.monthly) * 100);
      if (best === null || pct > best) best = pct;
    }
  }
  return best;
}

// Per-tier display numbers shipped to the cards. `credits` is the free tier's
// signup grant or a paid tier's monthly allotment; `slides` is the per-tier cap.
// Plan-keyed so consumers look up by plan, not array position.
export type TierDisplayNumber = { plan: string; credits: number; slides: number };

/** Look up a tier's display numbers by plan, tolerating an absent list. */
export function tierNumberFor(
  list: readonly TierDisplayNumber[] | undefined,
  plan: string,
): TierDisplayNumber | undefined {
  return list?.find((t) => t.plan === plan);
}
