// One-time backfill for `User.signupIp/signupCountry/signupCity`.
//
// The columns are stamped at provisioning time from Cloudflare headers for
// NEW users; this fills them for pre-existing rows from the signup-grant
// audit trail: the earliest `credit.grant.signup` / `credit.signup.blocked`
// UsageEvent already carries `metadata.ip`. Country/city come from a one-off
// ip-api.com lookup (free endpoint, 45 req/min - fine at current user
// counts; lookups are deduped per IP and spaced ~1.5s apart).
//
// Users with no IP-bearing event (pre-velocity-guard rows) are listed and
// skipped.
//
// Usage:
//   npx tsx scripts/backfill-signup-geo.ts            # dry-run
//   npx tsx scripts/backfill-signup-geo.ts --apply    # write

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { sanitizeCity, sanitizeCountry, sanitizeIp } from "../lib/api/geo";

const APPLY = process.argv.includes("--apply");
const LOOKUP_DELAY_MS = 1500;

type GeoLookup = { country: string | null; city: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookupGeo(
  ip: string,
  cache: Map<string, GeoLookup>,
): Promise<GeoLookup> {
  const cached = cache.get(ip);
  if (cached) return cached;
  let result: GeoLookup = { country: null, city: null };
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,city`,
    );
    const json = (await res.json()) as {
      status?: string;
      countryCode?: string;
      city?: string;
    };
    if (json.status === "success") {
      result = {
        country: sanitizeCountry(json.countryCode),
        city: sanitizeCity(json.city),
      };
    }
  } catch (err) {
    console.warn(
      `  geoip lookup failed for ${ip}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  cache.set(ip, result);
  await sleep(LOOKUP_DELAY_MS);
  return result;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (.env.local)");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const users = await prisma.user.findMany({
      where: { signupIp: null },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(
      `Found ${users.length} user(s) without signupIp. ${
        APPLY ? "Applying writes." : "Dry-run (no --apply)."
      }\n`,
    );

    const geoCache = new Map<string, GeoLookup>();
    const ipUsers = new Map<string, string[]>(); // ip -> emails (shared-IP report)
    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      const event = await prisma.usageEvent.findFirst({
        where: {
          userId: user.id,
          eventType: { in: ["credit.grant.signup", "credit.signup.blocked"] },
        },
        orderBy: { createdAt: "asc" },
        select: { metadata: true },
      });
      const rawIp =
        event?.metadata &&
        typeof event.metadata === "object" &&
        !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>).ip
          : null;
      const ip = sanitizeIp(typeof rawIp === "string" ? rawIp : null);
      if (!ip) {
        console.log(`- ${user.email}: no IP on signup events, skipping`);
        skipped += 1;
        continue;
      }

      const geo = await lookupGeo(ip, geoCache);
      ipUsers.set(ip, [...(ipUsers.get(ip) ?? []), user.email]);
      console.log(
        `- ${user.email}: ${ip} -> ${[geo.city, geo.country].filter(Boolean).join(", ") || "(no geo)"}`,
      );

      if (APPLY) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            signupIp: ip,
            signupCountry: geo.country,
            signupCity: geo.city,
          },
        });
      }
      updated += 1;
    }

    const shared = [...ipUsers.entries()].filter(([, emails]) => emails.length > 1);
    if (shared.length > 0) {
      console.log("\nShared signup IPs:");
      for (const [ip, emails] of shared) {
        console.log(`  ${ip}: ${emails.join(", ")}`);
      }
    }
    console.log(
      `\n${APPLY ? "Updated" : "Would update"} ${updated} user(s), skipped ${skipped}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
