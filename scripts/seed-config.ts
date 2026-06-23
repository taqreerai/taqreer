// Seed the runtime-config tables (Preset / Tier / PlatformSettings) from the
// SEED constants in lib/config/runtime-config.ts so the DB == the code
// constants. Idempotent (upserts). Run against the LOCAL dev DB:
//
//   DATABASE_URL="<dev url>" npx tsx scripts/seed-config.ts
//
// On prod this runs once after the migration deploys (same command, prod url).
import { seedConfig } from "../lib/config/runtime-config";
import { prisma } from "../lib/prisma";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await seedConfig();
  const [presets, tiers, settings] = await Promise.all([
    prisma.preset.count(),
    prisma.tier.count(),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  console.log(
    `seeded: ${presets} presets, ${tiers} tiers, configVersion=${settings?.configVersion}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
