// One-off migration for the Sonnet-as-free-model restructure (2026-07-21).
// seed-config.ts is CREATE-only and never touches Tier.unlockedPresetKeys or
// existing Preset rows, so the DB must be reconciled explicitly. Idempotent.
//
//   local:  npx tsx scripts/restructure-presets-sonnet.ts
//   prod:   scp to the box + `cd /root/taqreer && node_modules/.bin/tsx scripts/restructure-presets-sonnet.ts`
//
// Writes the DB from the SAME SEED_PRESETS / SEED_TIERS the code ships with
// (lib/config/runtime-config.ts), so it can never drift from the seed:
//   - add sonnet-fast (sort 0, claude-sonnet-5, 160/27)
//   - reprice + reorder opus-fast (sort 1, 460/34) and opus-balanced (sort 2, 660/42)
//   - reactivate fable-low (sort 3, claude-fable-5, 960/72) as the Max-only tier
//   - deactivate opus-medium (sort 4) - kept for legacy decks
//   - tiers: free=[sonnet-fast], plus=[+opus-fast], pro=[+opus-balanced],
//     max=[+opus-balanced, +fable-low]
//   - bump PlatformSettings.configVersion so runtime-config reloads
import { config } from "dotenv";
import { existsSync } from "fs";
config({ path: existsSync(".env.local") ? ".env.local" : ".env" });

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { SEED_PRESETS, SEED_TIERS } = await import("@/lib/config/runtime-config");

  await prisma.$transaction(async (tx) => {
    for (const p of SEED_PRESETS) {
      const data = {
        label: p.label,
        model: p.model,
        thinking: p.thinking,
        effort: p.effort,
        maxTokens: p.maxTokens,
        baseCredits: p.baseCredits,
        perSlideCredits: p.perSlideCredits,
        secsPerSlide: p.secsPerSlide,
        baseOverheadSecs: p.baseOverheadSecs,
        active: p.active,
        sortOrder: p.sortOrder,
      };
      await tx.preset.upsert({
        where: { key: p.key },
        update: data,
        create: { key: p.key, ...data },
      });
    }
    for (const t of SEED_TIERS) {
      await tx.tier.update({
        where: { plan: t.plan },
        data: { unlockedPresetKeys: [...t.unlockedPresetKeys] },
      });
    }
    await tx.platformSettings.upsert({
      where: { id: "singleton" },
      update: { configVersion: { increment: 1 } },
      create: { id: "singleton", configVersion: 1 },
    });
  });

  // Report the resulting config.
  const presets = await prisma.preset.findMany({ orderBy: { sortOrder: "asc" } });
  console.log("=== presets ===");
  for (const p of presets)
    console.log(
      `  sort=${p.sortOrder} ${p.key.padEnd(14)} ${p.model} thinking=${p.thinking} active=${p.active} ${p.baseCredits}/${p.perSlideCredits} maxTok=${p.maxTokens}`,
    );
  const tiers = await prisma.tier.findMany({ orderBy: { sortOrder: "asc" } });
  console.log("=== tiers ===");
  for (const t of tiers) console.log(`  ${t.plan}: ${JSON.stringify(t.unlockedPresetKeys)}`);
  const ps = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  console.log("configVersion:", ps?.configVersion);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
