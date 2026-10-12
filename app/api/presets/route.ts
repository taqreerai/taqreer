// Public, read-only generation presets for SIGNED-OUT visitors (the guest
// create flow). /api/credits needs a session, so guests used to fall back to a
// bundled snapshot that drifted from the live config (stale model names and
// costs). This serves the live list instead.
//
// regionPreset is a DISPLAY-ONLY guess from the visitor's current Cloudflare
// country, so a visitor in a region-limited country sees the same menu they
// will get after signing up. It grants nothing: once signed in, the server
// decides from the account's stored signupCountry (lib/credits/region-model).

import { NextResponse } from "next/server";
import { sanitizeCountry } from "@/lib/api/geo";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { defaultPresetKey, ensureFresh } from "@/lib/config/runtime-config";
import { activePresetPayload } from "@/lib/credits/public-presets";
import { regionPresetForCountry } from "@/lib/credits/region-model";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (rateLimited(`presets:${clientIp(request)}`, 60, 10 * 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  await ensureFresh();
  const country = sanitizeCountry(request.headers.get("cf-ipcountry"));
  return NextResponse.json(
    {
      presets: activePresetPayload(),
      defaultPresetKey: defaultPresetKey(),
      regionPreset: regionPresetForCountry(country),
    },
    // Varies by visitor country: never cache in a shared cache.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
