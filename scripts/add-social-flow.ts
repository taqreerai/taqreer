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
    let changed = 0;
    for (const plan of PAID_TIERS) {
      const tier = await prisma.tier.findUnique({ where: { plan } });
      if (!tier) {
        console.log(`- ${plan}: no row, skipped`);
        continue;
      }
      if (tier.flows.includes("social")) {
        console.log(`- ${plan}: already has social`);
        continue;
      }
      await prisma.tier.update({
        where: { plan },
        data: { flows: [...tier.flows, "social"] },
      });
      changed++;
      console.log(`+ ${plan}: added social -> [${[...tier.flows, "social"].join(", ")}]`);
    }
    if (changed > 0) {
      await prisma.platformSettings.update({
        where: { id: "singleton" },
        data: { configVersion: { increment: 1 } },
      });
      console.log(`bumped configVersion (${changed} tier(s) updated)`);
    } else {
      console.log("no changes");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
