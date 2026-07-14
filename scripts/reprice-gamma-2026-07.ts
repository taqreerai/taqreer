// One-off: apply the 2026-07-14 Gamma-parity repricing to the LIVE config
// rows. seedConfig() is create-only by design, so existing DBs keep their old
// numbers until this runs. Idempotent (updates to ABSOLUTE values, not
// increments) and prod-safe (only touches the fields that changed). Bumps
// configVersion so every worker's ensureFresh picks it up within the 30s TTL.
//
//   npx tsx scripts/reprice-gamma-2026-07.ts          # local (docker DB)
//   run on the prod box after deploy (DATABASE_URL from the prod env)
//
// Changes (2026-07-14 re-eval, owner-approved): prices matched to Gamma
// ($12/$25/$100), Max allotment 28,000 -> 21,000 (~60% full-burn margin on
// measured ~$0.0019/credit COGS), image credits 5 -> 10. free is set to
// 400/5 too (already the live prod value; a no-op there, brings local/fresh
// DBs into line). Plus/Pro credits unchanged.
//
// NOTE: prices are DISPLAY-only in the DB; the actual charge is the Stripe
// Price. Re-run scripts/stripe-setup-products.ts (or update Stripe) so the
// $12/$25/$100 monthly + yearly Prices exist BEFORE relying on checkout.
import { config } from "dotenv";
config({ path: ".env.local" });

const TIER_UPDATES: Record<
  string,
  { priceUsd?: number; monthlyAllotment?: number; signupGrant?: number; slideCap?: number }
> = {
  free: { priceUsd: 0, signupGrant: 400, slideCap: 5 },
  plus: { priceUsd: 12 },
  pro: { priceUsd: 25 },
  max: { priceUsd: 100, monthlyAllotment: 21000 },
};
const NEW_IMAGE_CREDITS = 10;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  for (const [plan, data] of Object.entries(TIER_UPDATES)) {
    const res = await prisma.tier.updateMany({ where: { plan }, data });
    console.log(
      res.count > 0
        ? `updated ${plan}: ${JSON.stringify(data)}`
        : `SKIPPED ${plan}: no row (unseeded DB serves the new SEED anyway)`,
    );
  }
  const settings = await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", configVersion: 1, imageCredits: NEW_IMAGE_CREDITS },
    update: { imageCredits: NEW_IMAGE_CREDITS, configVersion: { increment: 1 } },
    select: { configVersion: true, imageCredits: true, regenBaseCredits: true },
  });
  console.log("platform settings:", JSON.stringify(settings));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("REPRICE FAILED:", e);
  process.exit(1);
});
