// Export one deck to a portable JSON file, so a deck generated locally can be
// recreated on prod by scripts/import-deck.ts (e.g. to curate it as a template).
//
//   npx tsx --env-file=.env.local scripts/export-deck.ts <projectId> [out.json]
//
// Read-only. Carries the project metadata + the current manifest. Drops what
// is tied to the source DB (presentationId) or private to the source run
// (genChat, the generation's chat feed). Refuses decks with hosted assets
// (AI images, uploaded logos/fonts): those URLs belong to the source
// environment and are not carried across.
import fs from "fs";
import { prisma } from "../lib/prisma";
import { SlideManifestSchema } from "../lib/schema/slide";

async function main() {
  const projectId = process.argv[2];
  const out = process.argv[3] ?? `deck-${projectId}.json`;
  if (!projectId) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/export-deck.ts <projectId> [out.json]");
    process.exit(1);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      type: true,
      language: true,
      format: true,
      tone: true,
      status: true,
      dominantColor: true,
      colorTags: true,
      presentation: {
        select: { title: true, language: true, direction: true, currentVersionId: true },
      },
    },
  });
  if (!project?.presentation?.currentVersionId) throw new Error(`Project ${projectId} has no current version`);
  if (project.status !== "completed") throw new Error(`Project ${projectId} is ${project.status}, not completed`);

  const version = await prisma.presentationVersion.findUnique({
    where: { id: project.presentation.currentVersionId },
    select: { slideJson: true },
  });
  const parsed = SlideManifestSchema.safeParse(version?.slideJson);
  if (!parsed.success) throw new Error(`Manifest failed validation: ${parsed.error.message}`);

  // Theme font URLs (Google Fonts) are fine; anything hosted inside the
  // slides themselves is not portable.
  const assetUrls = JSON.stringify(parsed.data.slides).match(/https?:[^"' )]+/g) ?? [];
  if (assetUrls.length > 0) {
    throw new Error(`Deck references hosted assets, not portable: ${[...new Set(assetUrls)].slice(0, 5).join(", ")}`);
  }

  const manifest: Record<string, unknown> = { ...parsed.data };
  delete manifest.presentationId;
  delete manifest.genChat;

  const { presentation, status: _status, ...meta } = project;
  const payload = {
    exportedAt: new Date().toISOString(),
    sourceProjectId: projectId,
    project: meta,
    presentation: { title: presentation.title, language: presentation.language, direction: presentation.direction },
    manifest,
  };
  fs.writeFileSync(out, JSON.stringify(payload, null, 1));
  console.log(`Exported "${project.title}" (${parsed.data.slides.length} slides) -> ${out}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
