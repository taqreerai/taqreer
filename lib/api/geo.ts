// Signup geo extraction from Cloudflare headers, used to stamp the
// User.signupIp/signupCountry/signupCity forensics columns at provisioning
// time and to enrich signup-grant audit metadata (lib/credits/signup.ts).
//
// `cf-ipcountry` arrives on every proxied request by default; `cf-ipcity`
// requires the free "Add visitor location headers" Managed Transform on the
// zone (Rules -> Settings -> Managed Transforms) and is percent-encoded for
// non-ASCII names. All of these are ultimately attacker-influenced header
// values (a direct-to-origin request can forge them), so everything is
// validated/truncated before it touches the DB.

import { clientIpFromHeaders } from "@/lib/api/rate-limit";

export type SignupGeo = {
  ip: string | null;
  country: string | null; // ISO 3166-1 alpha-2 (CF also sends XX/T1 for unknown/Tor)
  city: string | null;
};

// Max textual IPv6 length is 45 chars (IPv4-mapped form).
const IP_MAX_LEN = 45;
const IP_RE = /^[0-9a-fA-F:.]+$/;
const COUNTRY_RE = /^[A-Z0-9]{2}$/; // A2 codes + CF sentinels XX / T1
const CITY_MAX_LEN = 64;

/**
 * Charset/length-validated IP, or null. Lowercased so IPv6 text-form case
 * differences can't split the shared-IP grouping in the admin users list
 * (CR PR #121). Zero-compression variants are left alone - Cloudflare emits
 * a consistent compressed form.
 */
export function sanitizeIp(raw: string | null | undefined): string | null {
  const ip = raw?.trim().toLowerCase();
  if (!ip || ip.length > IP_MAX_LEN || !IP_RE.test(ip)) return null;
  return ip;
}

/** Uppercased 2-char country code, or null. */
export function sanitizeCountry(raw: string | null | undefined): string | null {
  const country = raw?.trim().toUpperCase();
  if (!country || !COUNTRY_RE.test(country)) return null;
  return country;
}

/** Decoded, control-char-stripped, length-capped city name, or null. */
export function sanitizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let city = raw;
  try {
    city = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding - keep the raw value.
  }
  city = city
    .replace(/[\x00-\x1f\x7f<>"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CITY_MAX_LEN)
    .trim();
  return city.length > 0 ? city : null;
}

/**
 * Signup geo from request headers. Accepts anything with `.get()` so both a
 * `Request`'s `Headers` and the `next/headers` ReadonlyHeaders work.
 */
export function signupGeoFromHeaders(headers: {
  get(name: string): string | null;
}): SignupGeo {
  return {
    ip: sanitizeIp(clientIpFromHeaders(headers)),
    country: sanitizeCountry(headers.get("cf-ipcountry")),
    city: sanitizeCity(headers.get("cf-ipcity")),
  };
}
