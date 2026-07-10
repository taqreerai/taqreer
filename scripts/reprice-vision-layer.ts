// One-off: apply the 2026-07-10 VISION-LAYER repricing to the LIVE config
// rows (seed-config is create-only by design, so existing DBs keep their old
// numbers until this runs). Owner-approved 2026-07-10: +60 base +12/slide on
// every preset (the freeze bake's vision review is a second Opus call on
// every generation), and the new regenBaseCredits=70 flat per regen run.
// Bumps configVersion so every worker's ensureFresh picks it up within the
// 30s TTL. Idempotent: updates to absolute values, not increments.
//
//   npx tsx scripts/reprice-vision-layer.ts          # local (docker DB)
//   run on prod from the box after deploy (DATABASE_URL from the prod env)
//
// NOTE: after running on prod, open /admin/settings and re-save any surface
// once (or redeploy) if the pricing pages need an immediate revalidate -
// workers pick the charge numbers up on their own.
import { config } from "dotenv";
config({ path: ".env.local" });

const NEW_PRESET_PRICES: Record<string, { base: number; perSlide: number }> = {
  "opus-fast": { base: 160, perSlide: 27 },
  "opus-balanced": { base: 460, perSlide: 34 },
  "opus-medium": { base: 660, perSlide: 42 },
  "fable-low": { base: 960, perSlide: 72 },
};
const NEW_REGEN_BASE = 70;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  for (const [key, { base, perSlide }] of Object.entries(NEW_PRESET_PRICES)) {
    const res = await prisma.preset.updateMany({
      where: { key },
      data: { baseCredits: base, perSlideCredits: perSlide },
    });
    console.log(
      res.count > 0
        ? `updated ${key}: ${base} + ${perSlide}/slide`
        : `SKIPPED ${key}: no row (unseeded DB serves the new SEED anyway)`,
    );
  }
  const settings = await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", configVersion: 1, regenBaseCredits: NEW_REGEN_BASE },
    update: { regenBaseCredits: NEW_REGEN_BASE, configVersion: { increment: 1 } },
    select: { configVersion: true, imageCredits: true, regenBaseCredits: true },
  });
  console.log("platform settings:", JSON.stringify(settings));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("REPRICE FAILED:", e);
  process.exit(1);
});
