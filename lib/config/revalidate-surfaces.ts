// The marketing surfaces that DISPLAY live config / Stripe values: the landing
// + /pricing (tier prices, free credits, allotments, slide caps) and the
// design-system reference (§15 per-deck costs). They are force-static / baked,
// so any change to the underlying numbers must bust the Next full-route cache
// AND the Cloudflare edge here, or the cards keep serving build-time values.
//
// Two callers feed this: admin Settings writes (lib/config/settings-mutations)
// for config numbers, and the Stripe webhook (price/product events) for prices.
import { revalidatePath } from "next/cache";
import { purgeCloudflarePaths } from "@/lib/cloudflare/purge";
import { invalidateDisplayPrices } from "@/lib/billing/display-prices";

export const CONFIG_SURFACES = [
  "/ar",
  "/en",
  "/ar/pricing",
  "/en/pricing",
  // The design-system reference (§15) shows live per-deck credit costs.
  "/ar/brand",
  "/en/brand",
];

// Drop the in-process Stripe-price cache (so the re-render re-fetches live
// prices), revalidate the Next route cache, then purge the Cloudflare edge.
export async function revalidatePricingSurfaces(): Promise<void> {
  invalidateDisplayPrices();
  for (const p of CONFIG_SURFACES) revalidatePath(p);
  await purgeCloudflarePaths(CONFIG_SURFACES);
}
