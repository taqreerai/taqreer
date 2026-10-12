// Free-plan model by signup country (owner decision 2026-10-12): free accounts
// that signed up from a low-converting country generate with Haiku 5.5 only;
// every other free account keeps the tier's presets (Sonnet 5.5). Paid plans
// and admins are never affected. Keyed on User.signupCountry (Cloudflare's
// country at signup), never on the current request, so it can't be switched
// from the browser or a later VPN hop. Edit the set to add or remove countries.
//
// Data behind the list (prod, 2026-10-12, ever-subscribed / users): EG 5/178,
// IN 1/46, IQ 1/36, YE 1/27, TN 0/22, against SA 33/342, AE 6/54, OM 9/141.

import { normalizePlan } from "@/lib/plan";
import { getActivePresetKeys } from "@/lib/config/runtime-config";

export const HAIKU_FREE_COUNTRIES = new Set(["EG", "IN", "IQ", "YE", "TN"]);

/** The preset key (admin Settings) these accounts are limited to. */
export const REGION_FREE_PRESET = "haiku-5-5-fast";

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
  if (user.role === "admin" || normalizePlan(user.plan) !== "free") return null;
  const country = user.signupCountry?.toUpperCase();
  if (!country || !HAIKU_FREE_COUNTRIES.has(country)) return null;
  return getActivePresetKeys().includes(REGION_FREE_PRESET) ? REGION_FREE_PRESET : null;
}
