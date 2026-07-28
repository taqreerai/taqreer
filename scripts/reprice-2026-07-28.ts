// One-off: apply the 2026-07-28 reprice to the LIVE config rows. Same recipe
// as scripts/reprice-gamma-2026-07.ts (one transaction, aborts on a missing
// Tier row, idempotent absolute values, configVersion bumped every run so
// ensureFresh picks it up within the 30s TTL).
//
// Changes (owner-approved 2026-07-28, margin re-eval on prod Job telemetry):
// Plus $12 -> $9, Max $100 -> $79, Pro HELD at $25 (a $19 Pro would breach
// the >=50% full-burn margin floor; opus-balanced burns ~2.5x opus-fast).
// Credits/caps/grants unchanged. Free tier untouched.
//
// NOTE: prices are DISPLAY-only in the DB; the actual charge is the Stripe
// Price. Run scripts/stripe-setup-products.ts --live BEFORE this so the
// $9/$79 monthly + yearly Prices exist (lookup keys transfer to the new
// Prices; checkout resolves by lookup_key at runtime).
//
//   npx tsx scripts/reprice-2026-07-28.ts     # local (docker DB)
//   run on the prod box (DATABASE_URL from the prod env)
import { config } from "dotenv";
config({ path: ".env.local" });

const TIER_UPDATES: Record<string, { priceUsd: number }> = {
  plus: { priceUsd: 9 },
  max: { priceUsd: 79 },
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const settings = await prisma.$transaction(async (tx) => {
    for (const [plan, data] of Object.entries(TIER_UPDATES)) {
      const res = await tx.tier.updateMany({ where: { plan }, data });
      if (res.count !== 1) {
        throw new Error(
          `expected exactly 1 "${plan}" Tier row, updated ${res.count} - aborting (seed the DB first)`,
        );
      }
      console.log(`updated ${plan}: ${JSON.stringify(data)}`);
    }
    return tx.platformSettings.update({
      where: { id: "singleton" },
      data: { configVersion: { increment: 1 } },
      select: { configVersion: true },
    });
  });
  console.log("configVersion:", settings.configVersion);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("REPRICE FAILED:", e);
  process.exit(1);
});
