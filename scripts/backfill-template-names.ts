// One-off backfill for `Project.templateName`.
//
// New decks generated post-2026-05-21 get a Claude-Haiku-generated
// templateName inside the deck-generate Inngest function. Legacy
// decks created before that landed have `templateName = null` and
// would fall back to a deterministic placeholder when the user
// saves them as a template.
//
// This script walks every project with null templateName, pulls
// the brand attributes from its latest completed manifest, fires
// the same Haiku call deck-generate uses, and writes the result.
// Idempotent: re-running after --apply is a no-op (no projects
// left with null templateName).
//
// Usage:
//   pnpm tsx scripts/backfill-template-names.ts            # dry-run
//   pnpm tsx scripts/backfill-template-names.ts --apply    # write

import { config } from "dotenv";
// override:true — Claude for Desktop exports ANTHROPIC_API_KEY="" into the
// shell, which dotenv treats as "already set" and refuses to overwrite.
// Without override, getClient() reads "" and silently returns null, making
// every Haiku call look like an API failure.
config({ path: ".env.local", override: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { generateTemplateName } from "../lib/template/generate-name";
import { SlideManifestSchema } from "../lib/schema/slide";

const APPLY = process.argv.includes("--apply");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (.env.local)");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const candidates = await prisma.project.findMany({
      where: { templateName: null },
      select: {
        id: true,
        title: true,
        language: true,
        presentation: {
          select: {
            currentVersionId: true,
            versions: {
              where: { status: "completed" },
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { slideJson: true },
            },
          },
        },
      },
    });

    console.log(
      `Found ${candidates.length} project(s) with null templateName. ${
        APPLY ? "Applying writes." : "Dry-run (no --apply)."
      }\n`,
    );

    let written = 0;
    let skipped = 0;
    let failed = 0;
    for (const project of candidates) {
      const versionJson = project.presentation?.versions[0]?.slideJson;
      if (!versionJson) {
        console.log(
          `  SKIP  ${project.id} "${project.title.slice(0, 40)}" — no completed manifest`,
        );
        skipped++;
        continue;
      }
      const parsed = SlideManifestSchema.safeParse(versionJson);
      if (!parsed.success) {
        console.log(
          `  SKIP  ${project.id} "${project.title.slice(0, 40)}" — manifest validation failed`,
        );
        skipped++;
        continue;
      }
      const manifest = parsed.data;
      const palette = manifest.theme.palette ?? [];
      const headingFont = manifest.theme.fontHeading?.name ?? "Default";
      const bodyFont = manifest.theme.fontBody?.name ?? "Default";
      const lang: "ar" | "en" =
        project.language === "en" ? "en" : "ar";

      const name = await generateTemplateName({
        palette,
        fontHeading: headingFont,
        fontBody: bodyFont,
        language: lang,
      });

      if (!name) {
        console.log(
          `  FAIL  ${project.id} "${project.title.slice(0, 40)}" — Haiku call failed`,
        );
        failed++;
        continue;
      }
      console.log(
        `  ${APPLY ? "OK    " : "PROP  "} ${project.id} "${project.title.slice(0, 30)}" → "${name}"`,
      );
      if (APPLY) {
        await prisma.project.updateMany({
          where: { id: project.id, templateName: null },
          data: { templateName: name },
        });
        written++;
      }
    }
    if (APPLY) {
      console.log(
        `\nWrote ${written} project(s). Skipped ${skipped}. Failed ${failed}.`,
      );
    } else {
      console.log(`\nRe-run with --apply to commit. (Would write ${candidates.length - skipped - failed}, skip ${skipped}, fail ${failed} based on dry-run probe.)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
