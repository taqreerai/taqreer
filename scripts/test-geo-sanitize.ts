// Behavioral lock for lib/api/geo.ts city sanitization (CR nitpick on
// PR #131). This repo has no test runner, so this is a self-checking
// script: `npx tsx scripts/test-geo-sanitize.ts` — exits non-zero on any
// failed assertion. Covers the mojibake-repair heuristic, which operates
// on attacker-influenced signup PII in a display + DB-write path, so its
// "repair only real mojibake, never touch correct Unicode" contract is
// worth pinning.

import { sanitizeCity, sanitizeCountry, sanitizeIp } from "@/lib/api/geo";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

// A city name whose UTF-8 bytes arrive decoded as latin-1 (Cloudflare
// doesn't percent-encode every value) surfaces as mojibake.
const mojibake = (s: string) => Buffer.from(s, "utf-8").toString("latin1");

// 1. Mojibake round-trip: latin-1 byte view of an Arabic name repairs.
check("mojibake Arabic → repaired", sanitizeCity(mojibake("الرياض")), "الرياض");
// 2. Mojibake round-trip: accented Latin.
check("mojibake Latin → repaired", sanitizeCity(mojibake("Ṭaʼif")), "Ṭaʼif");
// 3. Already-correct Arabic passes through untouched.
check("correct Arabic unchanged", sanitizeCity("جدة"), "جدة");
// 4. Already-correct accented Latin passes through untouched.
check("correct accented Latin unchanged", sanitizeCity("São Paulo"), "São Paulo");
// 5. Mixed script passes through untouched (already correct Unicode).
check("mixed script unchanged", sanitizeCity("Dubai دبي"), "Dubai دبي");
// 6. Plain ASCII unchanged.
check("ASCII unchanged", sanitizeCity("Riyadh"), "Riyadh");
// 7. Percent-encoded value is decoded.
check("percent-encoded decoded", sanitizeCity("Abu%20Dhabi"), "Abu Dhabi");
// 8. Empty / whitespace / null → null.
check("empty → null", sanitizeCity(""), null);
check("whitespace → null", sanitizeCity("   "), null);
check("null → null", sanitizeCity(null), null);
// 9. Control chars + angle brackets stripped.
check("control/angle stripped", sanitizeCity("Ri\x00ya<dh>"), "Riyadh");

// Spot-check the siblings while we're here.
check("IP lowercased", sanitizeIp("2001:DB8::1"), "2001:db8::1");
check("bad IP → null", sanitizeIp("not-an-ip"), null);
check("country upper", sanitizeCountry("sa"), "SA");
check("bad country → null", sanitizeCountry("SAU"), null);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
