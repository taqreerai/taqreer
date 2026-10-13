// Free-plan model by signup country (owner decision 2026-10-12): free accounts
// that signed up from a low-converting country generate with Haiku 5.5 only;
// every other free account keeps the tier's presets (Sonnet 5.5). Paid plans
// and admins are never affected. Keyed on User.signupCountry (Cloudflare's
// country at signup), never on the current request, so it can't be switched
// from the browser or a later VPN hop. Edit the set to add or remove countries.
//
// Data behind the list (prod, 2026-10-12, ever-subscribed / users): EG 5/178,
// IN 1/46, IQ 1/36, YE 1/27, TN 0/22, against SA 33/342, AE 6/54, OM 9/141.
// DZ and MA added by owner decision the same day. Recount with REAL payers only
// (Stripe subscription id or a cancelled paid sub; the free plan's placeholder
// Subscription rows excluded): OM 0/141, PS 0/12, LY 0/11, SD 0/8, LB 0/5,
// PK 0/6, IR 0/8, SY 0/6 - all added. IR and SY also get NO signup grant
// (lib/credits/signup.ts): Stripe cannot take payments there.

import { normalizePlan } from "@/lib/plan";
import { getActivePresetKeys } from "@/lib/config/runtime-config";

export const HAIKU_FREE_COUNTRIES = new Set([
  "EG", "IN", "IQ", "YE", "TN", "DZ", "MA",
  "OM", "PS", "LY", "SD", "LB", "PK", "IR", "SY",
  // JO added by owner decision 2026-10-13.
  "JO",
]);

/** The preset key (admin Settings) these accounts are limited to. */
export const REGION_FREE_PRESET = "haiku-5-5-fast";

/**
 * Free (non-admin) account that signed up from a listed country. Drives the
 * Haiku-only model AND the regional one-time unlock price, independent of
 * whether the Haiku preset is active.
 */
export function isRegionLimitedFree(user: {
  plan: string | null;
  role: string | null;
  signupCountry: string | null;
}): boolean {
  if (user.role === "admin" || normalizePlan(user.plan) !== "free") return false;
  const country = user.signupCountry?.toUpperCase();
  return !!country && HAIKU_FREE_COUNTRIES.has(country);
}

/**
 * Display-only: the region preset a visitor from `country` would get after
 * signing up (the signed-out picker). Grants nothing by itself.
 */
export function regionPresetForCountry(country: string | null): string | null {
  const c = country?.toUpperCase();
  if (!c || !HAIKU_FREE_COUNTRIES.has(c)) return null;
  return getActivePresetKeys().includes(REGION_FREE_PRESET) ? REGION_FREE_PRESET : null;
}

/**
 * The single preset this user is limited to, or null when the normal tier
 * presets apply. Also null when the Haiku preset is missing or inactive, so a
 * deactivated preset falls back to the tier instead of blocking generation.
 */
export function regionFreePreset(user: {
  plan: string | null;
  role: string | null;
  signupCountry: string | null;
}): string | null {
  if (!isRegionLimitedFree(user)) return null;
  return getActivePresetKeys().includes(REGION_FREE_PRESET) ? REGION_FREE_PRESET : null;
}
