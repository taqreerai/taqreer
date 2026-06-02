// Location-aware lifestyle imagery (follow-up to context/images.md).
//
// An images-deck reserves boxes that gpt-image-2 fills from prompts Claude
// writes. By default those people are a generic/global cast, so a deck
// generated from Saudi Arabia could come back full of unrelated faces. This
// maps the REQUEST's country (the "area of generation") to a respectful
// regional descriptor that gets injected into the lifestyle-image directive,
// so the people on screen reflect the local audience.
//
// Returns null when the country can't be determined — callers then omit the
// directive entirely and Claude infers the cast from the slide content, i.e.
// the exact pre-feature behaviour (no regression on unknown geo).

// ISO-3166-1 alpha-2 country headers that common edge/proxy layers inject
// for the visitor. Checked in order; first real value wins. Self-hosted
// deployments without a geo-aware proxy can pin a default via the
// IMAGE_REGION_DEFAULT_COUNTRY env var (also handy for local-dev testing).
const GEO_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country", // Vercel
  "x-geo-country", // generic / custom reverse proxy
  "x-country-code",
] as const;

// Header values that mean "couldn't resolve" rather than a real country.
const UNKNOWN_CODES = new Set(["", "XX", "ZZ", "T1", "A1", "A2", "O1"]);

/** Resolve the request's ISO-3166-1 alpha-2 country, or null when unknown. */
export function detectCountry(headers: Headers): string | null {
  for (const name of GEO_HEADERS) {
    const value = headers.get(name)?.trim().toUpperCase();
    if (value && !UNKNOWN_CODES.has(value)) return value;
  }
  const fallback = process.env.IMAGE_REGION_DEFAULT_COUNTRY?.trim().toUpperCase();
  return fallback && !UNKNOWN_CODES.has(fallback) ? fallback : null;
}

// MENA-precise descriptors. A cultural region ("Gulf Arab") reads far better
// to an image model than a bare nationality, and groups neighbours that share
// an appearance. Each value is a full noun phrase so it slots into the
// directive as "...depict any people as <descriptor>". Countries outside this
// map fall back to the country's English name via Intl.DisplayNames.
const REGION_DESCRIPTOR: Record<string, string> = {
  SA: "Gulf Arab (Khaleeji) people",
  AE: "Gulf Arab (Khaleeji) people",
  KW: "Gulf Arab (Khaleeji) people",
  QA: "Gulf Arab (Khaleeji) people",
  BH: "Gulf Arab (Khaleeji) people",
  OM: "Gulf Arab (Khaleeji) people",
  JO: "Levantine Arab people",
  LB: "Levantine Arab people",
  SY: "Levantine Arab people",
  PS: "Levantine Arab people",
  IQ: "Iraqi Arab people",
  EG: "Egyptian people",
  SD: "Sudanese people",
  YE: "Yemeni people",
  MA: "North African (Maghrebi) people",
  DZ: "North African (Maghrebi) people",
  TN: "North African (Maghrebi) people",
  LY: "Libyan people",
  TR: "Turkish people",
  IR: "Iranian (Persian) people",
};

let displayNames: Intl.DisplayNames | null = null;
function countryName(code: string): string | null {
  try {
    displayNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = displayNames.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * Header set → a people descriptor for the lifestyle-image directive, or
 * null when the request's country can't be determined.
 */
export function detectImageRegion(headers: Headers): string | null {
  const country = detectCountry(headers);
  if (!country) return null;
  const precise = REGION_DESCRIPTOR[country];
  if (precise) return precise;
  const name = countryName(country);
  return name ? `local people of ${name}` : null;
}
