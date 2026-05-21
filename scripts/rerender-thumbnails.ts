// One-off admin script: re-fire the thumbnail-render Inngest event
// for a project's already-saved version.
//
// Why this exists: the Save button on the preview toolbar greys out
// when there are no unsaved changes, so users can't "just re-save" to
// regenerate thumbnails. And the save route's Inngest event id is
// `thumbnails:${projectId}:${savedVersionId}` — Inngest dedupes
// within a short window, so even if we forced a re-save the event
// would be dropped if fired within 24h of the original.
//
// This script sends the SAME event payload (so the Inngest function
// renders the canonical savedVersionId) but with a uniqueness-suffixed
// dedupe id (`thumbnails-rerender:<projectId>:<savedVersionId>:<ts>`)
// so Inngest accepts it. The Inngest function uses `upsert: true` on
// the storage upload, so the re-render overwrites the previous
// (incorrect "slide 1 × N") thumbnails in place at the same paths —
// no stale URL drift.
//
// Usage:
//   pnpm tsx scripts/rerender-thumbnails.ts <projectId>
//
// Requires `.env.local` with DATABASE_URL + INNGEST_EVENT_KEY (dev
// inferred automatically when running against the local dev server).

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Inngest } from "inngest";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: pnpm tsx scripts/rerender-thumbnails.ts <projectId>");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (check .env.local)");
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  // Match the in-app Inngest client (id "taqreer") so events land on
  // the same function in the dev server.
  const inngest = new Inngest({ id: "taqreer", name: "Taqreer" });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        presentation: { select: { savedVersionId: true } },
      },
    });
    if (!project) {
      console.error(`Project ${projectId} not found`);
      process.exit(1);
    }
    const savedVersionId = project.presentation?.savedVersionId;
    if (!savedVersionId) {
      console.error(
        `Project ${projectId} ("${project.title}") has no savedVersionId — nothing to re-render. Save the deck first.`,
      );
      process.exit(1);
    }

    const dedupeId = `thumbnails-rerender:${projectId}:${savedVersionId}:${Date.now()}`;
    console.log(`Firing deck.thumbnails.render`);
    console.log(`  project          : ${projectId} ("${project.title}")`);
    console.log(`  savedVersionId   : ${savedVersionId}`);
    console.log(`  dedupe id        : ${dedupeId}`);

    await inngest.send({
      id: dedupeId,
      name: "deck.thumbnails.render",
      data: { projectId, savedVersionId },
    });

    console.log(
      "\nEvent queued. Watch the Inngest dev UI (http://localhost:8288) for run status.",
    );
    console.log(
      "Once the run completes, refresh the dashboard — Project.thumbnailUrls will be rewritten.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
