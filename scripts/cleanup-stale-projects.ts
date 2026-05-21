// One-off cleanup pass for legacy library state. Runs two independent
// operations in dry-run / --apply mode:
//
//   PASS A — Backfill unsaved-completed decks.
//     Decks that finished generation BEFORE the auto-save wiring
//     landed (Chunk C, 2026-05-20) never had `savedVersionId` set
//     and never had a thumbnail-render job queued. They appear in
//     /projects with the static "no thumbnails" placeholder. This
//     pass sets `savedVersionId = currentVersionId` AND dispatches
//     `deck.thumbnails.render` for each so they catch up to the
//     post-Chunk-C contract: every completed deck has thumbs.
//
//   PASS B — Delete zombie queued/failed decks.
//     Projects whose version status is `queued` or `failed` AND
//     where the version's `createdAt` is more than 30 minutes ago
//     are stuck — the Inngest job died, the browser tab closed
//     mid-stream, or the generation actually failed. They clutter
//     the dashboard, redirect to a misleading /preview "generating"
//     screen, and have no thumbnails. This pass deletes them
//     (cascade cleans up Presentation, Versions, SlideStates, Files,
//     Jobs via the schema's onDelete relations). No Supabase storage
//     to clean — zombies never produced thumbnails.
//
// Usage:
//   pnpm tsx scripts/cleanup-stale-projects.ts            # dry-run
//   pnpm tsx scripts/cleanup-stale-projects.ts --apply    # commit
//
// Idempotent: re-running after --apply is a no-op (no zombies left,
// no unsaved-completed decks left to backfill).

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { Inngest } from "inngest";

const APPLY = process.argv.includes("--apply");
const ZOMBIE_AGE_MIN = 30; // minutes — versions older than this still in non-completed status

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  const inngest = new Inngest({ id: "taqreer", name: "Taqreer" });

  try {
    console.log(`\n=== Pass A: backfill unsaved-completed decks ===\n`);
    await passA_backfill(prisma, inngest);

    console.log(`\n=== Pass B: delete zombie queued/failed decks ===\n`);
    await passB_deleteZombies(prisma);

    console.log(`\n${APPLY ? "✓ Applied." : "Dry-run done. Re-run with --apply to commit."}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function passA_backfill(prisma: PrismaClient, inngest: Inngest) {
  // Find every deck whose presentation has no savedVersionId AND has
  // at least one completed version we can adopt as the canonical
  // save target.
  const candidates = await prisma.project.findMany({
    where: {
      presentation: {
        savedVersionId: null,
        versions: { some: { status: "completed" } },
      },
    },
    select: {
      id: true,
      title: true,
      presentation: {
        select: {
          id: true,
          currentVersionId: true,
          // The LATEST completed version — what we'll point
          // savedVersionId AND currentVersionId at. Using
          // currentVersionId blindly is wrong: caught 2026-05-21
          // when a partial-regen had left currentVersionId pointing
          // at a "failed" version (versionNumber=4) while the
          // newest completed was 2. Pass A used the failed v4 as
          // savedVersionId → deck loaded as "not ready" forever.
          versions: {
            where: { status: "completed" },
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { id: true, versionNumber: true },
          },
        },
      },
    },
  });

  console.log(`Found ${candidates.length} unsaved-completed deck(s).\n`);

  let written = 0;
  for (const project of candidates) {
    const pres = project.presentation;
    if (!pres) continue;
    const completed = pres.versions[0];
    if (!completed) {
      console.log(`  SKIP ${project.id} "${project.title.slice(0, 30)}" — no completed version`);
      continue;
    }
    const versionId = completed.id;
    console.log(`  ${project.id} "${project.title.slice(0, 30)}" → save + thumbnails (${versionId})`);
    if (!APPLY) continue;

    // Pull per-slide state so savedSlideVersions matches what the
    // live /save route would write. Empty {} is acceptable for decks
    // with no SlideState rows.
    const slideStates = await prisma.slideState.findMany({
      where: { presentationId: pres.id },
      select: { slideKey: true, currentVersionNumber: true },
    });
    const savedSlideVersions: Record<string, number> = {};
    for (const s of slideStates) {
      savedSlideVersions[s.slideKey] = s.currentVersionNumber;
    }

    // Atomic update guarded by savedVersionId:null — if another
    // process raced (unlikely for a one-shot, but matches the
    // deck-generate's first-save guard pattern) the second write is
    // a no-op.
    const promoted = await prisma.presentation.updateMany({
      where: { id: pres.id, savedVersionId: null },
      data: {
        // Pin BOTH pointers to the latest completed version. Without
        // also updating currentVersionId, a stale pointer to a
        // failed regen attempt would keep /project redirecting to
        // /preview (the isDeckReady gate reads currentVersionId's
        // status). Resetting both keeps the deck navigable + matches
        // what the live save route does for healthy decks (where
        // currentVersionId IS already the canonical completed
        // version).
        savedVersionId: versionId,
        currentVersionId: versionId,
        savedSlideVersions: savedSlideVersions as unknown as Prisma.InputJsonValue,
      },
    });
    if (promoted.count === 1) {
      // Also ensure Project.status reflects reality — a stuck
      // partial-regen could have left project.status = "queued"
      // even though we now point at a completed version.
      await prisma.project.update({
        where: { id: project.id },
        data: { status: "completed" },
      });
      await inngest.send({
        id: `thumbnails-backfill:${project.id}:${versionId}`,
        name: "deck.thumbnails.render",
        data: { projectId: project.id, savedVersionId: versionId },
      });
      written++;
    }
  }
  if (APPLY) console.log(`\nWrote ${written} deck(s) + dispatched thumbnail jobs.`);
}

async function passB_deleteZombies(prisma: PrismaClient) {
  const cutoff = new Date(Date.now() - ZOMBIE_AGE_MIN * 60 * 1000);
  // Zombie = no completed version exists AND at least one
  // non-completed version is older than the cutoff. Both conditions
  // ride on the SAME `versions` key so we don't silently overwrite
  // one with the other (the earlier `{ some: ... }` + `{ every: ... }`
  // sibling keys in the same object literal silently dropped the
  // age check — JS object-literal duplicate-key semantics. Critical
  // bug CR caught 2026-05-21: without the age check Pass B could
  // delete decks still legitimately generating in the last 30 min).
  const candidates = await prisma.project.findMany({
    where: {
      presentation: {
        versions: {
          every: { status: { not: "completed" } },
          some: {
            status: { in: ["queued", "failed"] },
            createdAt: { lt: cutoff },
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      presentation: {
        select: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { status: true, createdAt: true },
          },
        },
      },
    },
  });

  console.log(`Found ${candidates.length} zombie deck(s) (no completed version, ${ZOMBIE_AGE_MIN}+ min old).\n`);

  let deleted = 0;
  for (const project of candidates) {
    const v = project.presentation?.versions[0];
    console.log(
      `  ${project.id} "${project.title.slice(0, 30)}"  status=${v?.status}  age=${Math.round(
        (Date.now() - (v?.createdAt?.getTime() ?? Date.now())) / 60000,
      )}min`,
    );
    if (!APPLY) continue;
    // Cascade deletion — Project has onDelete: Cascade on the user
    // relation; child Presentation/Version/SlideState/etc. cascade
    // off Project's deletion via their own onDelete rules in the
    // schema. No Supabase storage to clean (zombies never produced
    // thumbnails / saved any file uploads).
    await prisma.project.delete({ where: { id: project.id } });
    deleted++;
  }
  if (APPLY) console.log(`\nDeleted ${deleted} deck(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
