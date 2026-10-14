// One-off: apply the 2026-10-14 reprice to the LIVE config rows. Same recipe as
// scripts/reprice-2026-07-28.ts (one transaction, aborts on a missing row,
// idempotent absolute values, configVersion bumped so ensureFresh picks it up
// within the 30s TTL).
//
// Changes (owner-approved 2026-10-14, margin re-eval at corrected Anthropic rates):
//   presets  sonnet-fast 160 + 27/slide -> 130 + 22/slide   (-20%)
//            fable-low   960 + 72/slide  -> 1,900 + 150/slide
//   tiers    pro $25 -> $19; max $79 -> $59 and 35,000 -> 30,000 credits/month
// Plus, Free, Opus presets and every cap/grant are untouched.
//
// NOTE: tier prices are DISPLAY-only in the DB; the actual charge is the Stripe
// Price. Run scripts/stripe-setup-products.ts --live BEFORE this so the $19 Pro
// and $59 Max monthly + yearly Prices ($16 and $50 per month yearly) exist
// (lookup keys transfer to the new Prices; checkout resolves by lookup_key).
//
//   npx tsx scripts/reprice-2026-10-14.ts           # DRY RUN (prints the plan)
//   npx tsx scripts/reprice-2026-10-14.ts --apply   # run on the prod box
import { config } from "dotenv";
config({ path: ".env.local" });

const PRESET_UPDATES: Record<string, { baseCredits: number; perSlideCredits: number }> = {
  "sonnet-fast": { baseCredits: 130, perSlideCredits: 22 },
  "fable-low": { baseCredits: 1900, perSlideCredits: 150 },
};
const TIER_UPDATES: Record<string, { priceUsd: number; monthlyAllotment?: number }> = {
  pro: { priceUsd: 19 },
  max: { priceUsd: 59, monthlyAllotment: 30000 },
};

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("@/lib/prisma");
  if (!apply) {
    const presets = await prisma.preset.findMany({
      where: { key: { in: Object.keys(PRESET_UPDATES) } },
      select: { key: true, baseCredits: true, perSlideCredits: true },
    });
    const tiers = await prisma.tier.findMany({
      where: { plan: { in: Object.keys(TIER_UPDATES) } },
      select: { plan: true, priceUsd: true, monthlyAllotment: true },
    });
    console.log("DRY RUN - current live rows:", JSON.stringify({ presets, tiers }, null, 2));
    console.log("would set:", JSON.stringify({ PRESET_UPDATES, TIER_UPDATES }, null, 2));
    await prisma.$disconnect();
    return;
  }
  const settings = await prisma.$transaction(async (tx) => {
    for (const [key, data] of Object.entries(PRESET_UPDATES)) {
      const res = await tx.preset.updateMany({ where: { key }, data });
      if (res.count !== 1) {
        throw new Error(`expected exactly 1 "${key}" Preset row, updated ${res.count} - aborting`);
      }
      console.log(`updated preset ${key}: ${JSON.stringify(data)}`);
    }
    for (const [plan, data] of Object.entries(TIER_UPDATES)) {
      const res = await tx.tier.updateMany({ where: { plan }, data });
      if (res.count !== 1) {
        throw new Error(`expected exactly 1 "${plan}" Tier row, updated ${res.count} - aborting`);
      }
      console.log(`updated tier ${plan}: ${JSON.stringify(data)}`);
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
