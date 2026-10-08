// One-off repair (2026-10-08): decks unlocked before the deck-unlock fix kept
// their savedVersionId on the auto-saved TEASER version, so PNG / PDF export,
// the dashboard thumbnail and the library showed only the visible slides.
// Moves the saved pin to the current version for every unlocked project whose
// saved version predates the unlock (a save made after the unlock is left
// alone). Dry run by default; --apply writes.
//
//   tsx scripts/fix-unlocked-saved-version.ts           # list only
//   tsx scripts/fix-unlocked-saved-version.ts --apply   # write
//
// Runs against the current DATABASE_URL (local docker in dev; on the server
// it is the production database).

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const projects = await prisma.project.findMany({
    where: { teaserUnlockedAt: { not: null } },
    select: {
      id: true,
      teaserUnlockedAt: true,
      presentation: {
        select: { id: true, savedVersionId: true, currentVersionId: true },
      },
    },
  });

  let fixed = 0;
  for (const p of projects) {
    const pres = p.presentation;
    if (!pres?.savedVersionId || !pres.currentVersionId) continue;
    if (pres.savedVersionId === pres.currentVersionId) continue;
    const saved = await prisma.presentationVersion.findUnique({
      where: { id: pres.savedVersionId },
      select: { createdAt: true },
    });
    // Saved after the unlock = a deliberate save of the full deck: keep it.
    if (!saved || !p.teaserUnlockedAt || saved.createdAt >= p.teaserUnlockedAt) continue;
    console.log(`${apply ? "fix" : "would fix"} project ${p.id}: saved -> ${pres.currentVersionId}`);
    if (apply) {
      await prisma.presentation.update({
        where: { id: pres.id },
        data: { savedVersionId: pres.currentVersionId },
      });
    }
    fixed++;
  }
  console.log(`${fixed} project(s) ${apply ? "fixed" : "to fix"} of ${projects.length} unlocked.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
