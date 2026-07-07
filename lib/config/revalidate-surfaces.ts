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
import {
  invalidateDisplayPrices,
  invalidateTopupDisplayPacks,
} from "@/lib/billing/display-prices";
import { invalidateLocal } from "@/lib/config/runtime-config";

export const CONFIG_SURFACES = [
  "/ar",
  "/en",
  "/ar/pricing",
  "/en/pricing",
  // The design-system reference (§15) shows live per-deck credit costs.
  "/ar/brand",
  "/en/brand",
];

// Drop the in-process runtime-config snapshot (tiers / presets / free credits)
// AND the Stripe-price cache, so the re-render reads fresh numbers even if the
// config snapshot TTL is still hot, then revalidate the Next route cache and
// purge the Cloudflare edge. Self-contained: a caller need not invalidate first.
export async function revalidatePricingSurfaces(): Promise<void> {
  invalidateLocal();
  invalidateDisplayPrices();
  invalidateTopupDisplayPacks();
  for (const p of CONFIG_SURFACES) revalidatePath(p);
  await purgeCloudflarePaths(CONFIG_SURFACES);
}
