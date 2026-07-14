// One-off: apply the 2026-07-14 Gamma-parity repricing to the LIVE config
// rows. seedConfig() is create-only by design, so existing DBs keep their old
// numbers until this runs. Runs in ONE transaction and aborts if any expected
// Tier row is missing or duplicated, so a mid-run failure never leaves prod
// half-repriced. The values it writes are idempotent (absolute, not
// increments); configVersion is intentionally bumped on each run so every
// worker's ensureFresh picks the change up within the 30s TTL. Requires a
// seeded DB (run scripts/seed-config.ts first on a fresh one).
//
//   npx tsx scripts/reprice-gamma-2026-07.ts          # local (docker DB)
//   run on the prod box after deploy (DATABASE_URL from the prod env)
//
// Changes (2026-07-14 re-eval, owner-approved): prices matched to Gamma
// ($12/$25/$100), Max allotment 28,000 -> 35,000 (~33% full-burn margin on
// measured ~$0.0019/credit COGS; keeps Max's credits-per-$ between Plus and
// Pro), image credits 5 -> 10. free is set to
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
  max: { priceUsd: 100, monthlyAllotment: 35000 },
};
const NEW_IMAGE_CREDITS = 10;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  // One transaction: tier updates + the settings bump commit or roll back
  // together, so a mid-run failure can never leave prod half-repriced.
  const settings = await prisma.$transaction(async (tx) => {
    for (const [plan, data] of Object.entries(TIER_UPDATES)) {
      const res = await tx.tier.updateMany({ where: { plan }, data });
      // plan is the PK, so exactly one row must match. 0 means the DB isn't
      // seeded as expected - abort loudly rather than partially reprice.
      if (res.count !== 1) {
        throw new Error(
          `expected exactly 1 "${plan}" Tier row, updated ${res.count} - aborting (seed the DB first)`,
        );
      }
      console.log(`updated ${plan}: ${JSON.stringify(data)}`);
    }
    return tx.platformSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", configVersion: 1, imageCredits: NEW_IMAGE_CREDITS },
      update: { imageCredits: NEW_IMAGE_CREDITS, configVersion: { increment: 1 } },
      select: { configVersion: true, imageCredits: true, regenBaseCredits: true },
    });
  });
  console.log("platform settings:", JSON.stringify(settings));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("REPRICE FAILED:", e);
  process.exit(1);
});
