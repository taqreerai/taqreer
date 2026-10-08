// Recreate a deck exported by scripts/export-deck.ts under a given account,
// then queue its thumbnail render. Built to land locally generated decks on
// prod under the curator account (dev@taqreer.ai), where "Save as template"
// + /admin/templates take over.
//
//   npx tsx --env-file=.env scripts/import-deck.ts <file.json> <ownerEmail> [--dry-run]
//
// Writes BOTH deck stores (PresentationVersion.slideJson + one SlideState /
// SlideVersion v1 per slide) in one transaction, marks the version saved, and
// sends deck.thumbnails.render so the dashboard tile fills in. Refuses when
// the owner already has a project with the same title (re-run safety).
import fs from "fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { inngest } from "../inngest/client";
import { SlideManifestSchema } from "../lib/schema/slide";

type ExportFile = {
  sourceProjectId: string;
  project: {
    title: string;
    type: string;
    language: string;
    format: string;
    tone: string;
    dominantColor: string | null;
    colorTags: string[];
  };
  presentation: { title: string; language: string; direction: string };
  manifest: Record<string, unknown>;
};

async function main() {
  const [file, ownerEmail] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  if (!file || !ownerEmail) {
    console.error("Usage: npx tsx --env-file=.env scripts/import-deck.ts <file.json> <ownerEmail> [--dry-run]");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8")) as ExportFile;
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner) throw new Error(`No user with email ${ownerEmail}`);

  const clash = await prisma.project.findFirst({
    where: { userId: owner.id, title: data.project.title },
    select: { id: true },
  });
  if (clash) throw new Error(`${ownerEmail} already has "${data.project.title}" (${clash.id}), not importing twice`);

  // Validate against the live schema with a placeholder id; the real id is
  // stamped once the Presentation row exists.
  const check = SlideManifestSchema.safeParse({ ...data.manifest, presentationId: "pending" });
  if (!check.success) throw new Error(`Manifest failed validation: ${check.error.message}`);
  const slides = check.data.slides;

  const dbHost = new URL(process.env.DATABASE_URL!).hostname;
  console.log(`Import "${data.project.title}" (${slides.length} slides) for ${ownerEmail} into ${dbHost}`);
  if (dryRun) {
    console.log("Dry run: nothing written.");
    return;
  }

  const ids = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        userId: owner.id,
        title: data.project.title,
        type: data.project.type,
        language: data.project.language,
        format: data.project.format,
        tone: data.project.tone,
        status: "completed",
        slideCount: slides.length,
        dominantColor: data.project.dominantColor,
        colorTags: data.project.colorTags,
      },
      select: { id: true },
    });
    const presentation = await tx.presentation.create({
      data: {
        projectId: project.id,
        title: data.presentation.title,
        language: data.presentation.language,
        direction: data.presentation.direction,
      },
      select: { id: true },
    });
    const version = await tx.presentationVersion.create({
      data: {
        presentationId: presentation.id,
        versionNumber: 1,
        status: "completed",
        slideJson: { ...check.data, presentationId: presentation.id } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    for (const slide of slides) {
      await tx.slideState.create({
        data: {
          presentationId: presentation.id,
          slideKey: slide.slideId,
          currentVersionNumber: 1,
          versions: {
            create: { versionNumber: 1, slideJson: slide as unknown as Prisma.InputJsonValue, source: "create" },
          },
        },
      });
    }
    await tx.presentation.update({
      where: { id: presentation.id },
      data: {
        currentVersionId: version.id,
        savedVersionId: version.id,
        savedSlideVersions: Object.fromEntries(slides.map((s) => [s.slideId, 1])),
      },
    });
    return { projectId: project.id, versionId: version.id };
  });
  console.log(`Created project ${ids.projectId} (version ${ids.versionId})`);

  try {
    await inngest.send({
      id: `thumbnails:${ids.projectId}:${ids.versionId}`,
      name: "deck.thumbnails.render",
      data: { projectId: ids.projectId, savedVersionId: ids.versionId },
    });
    console.log("Queued the thumbnail render.");
  } catch (err) {
    console.warn(
      `Thumbnail render not queued (${err instanceof Error ? err.message : err}). ` +
        `Run: npx tsx --env-file=.env scripts/rerender-thumbnails.ts ${ids.projectId}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
