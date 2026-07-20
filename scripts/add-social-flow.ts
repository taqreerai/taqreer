// One-off deploy migration: add the "social" flow to the DB-backed tier rows.
//
// seedConfig() upserts with `update: {}`, so it NEVER touches existing rows -
// re-running it can't add "social" to prod's live Tier rows. preflightGenerate
// reads those rows via getTier(), so without this every Plus/Pro/Max user hits
// `flow_locked` on /social despite the code. Idempotent: skips tiers that
// already include "social". Bumps configVersion so the runtime cache refreshes.
//
//   Run once on deploy:  npx tsx scripts/add-social-flow.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PAID_TIERS = ["plus", "pro", "max"] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    // One transaction so partial failure can't leave some tiers updated with
    // the runtime cache un-invalidated (configVersion un-bumped). Each tier is
    // re-read INSIDE the tx and updated with the row locked, so a concurrent
    // admin Settings edit to the same tier can't be clobbered by read-then-
    // replace. Idempotent: tiers that already have social are left untouched.
    const log = await prisma.$transaction(async (tx) => {
      const lines: string[] = [];
      let changed = 0;
      for (const plan of PAID_TIERS) {
        const tier = await tx.tier.findUnique({ where: { plan } });
        if (!tier) {
          lines.push(`- ${plan}: no row, skipped`);
          continue;
        }
        if (tier.flows.includes("social")) {
          lines.push(`- ${plan}: already has social`);
          continue;
        }
        const next = [...tier.flows, "social"];
        await tx.tier.update({ where: { plan }, data: { flows: next } });
        changed++;
        lines.push(`+ ${plan}: added social -> [${next.join(", ")}]`);
      }
      if (changed > 0) {
        await tx.platformSettings.update({
          where: { id: "singleton" },
          data: { configVersion: { increment: 1 } },
        });
        lines.push(`bumped configVersion (${changed} tier(s) updated)`);
      } else {
        lines.push("no changes");
      }
      return lines;
    });
    console.log(log.join("\n"));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
