// Per-slide versioning utilities. Called by the Inngest functions
// that produce slide content (deck-generate for initial generation,
// deck-regenerate-partial for single-slide regen) to keep the
// SlideState + SlideVersion tables in sync with whatever lives in
// PresentationVersion.slideJson.
//
// Why these tables exist (see prisma/schema.prisma):
// - SlideState carries lock + comment cache per slide.
// - SlideVersion is per-slide append-only history capped at 10
//   rows so the user can Undo / browse versions without the table
//   growing unbounded under heavy iteration.
//
// Idempotency: both helpers are designed to be safe under Inngest
// step retries — `seed*` uses upsert keyed on (presentationId,
// slideKey); `record*` looks up the latest versionNumber and writes
// max+1, so a duplicate call re-bumps but never collides on the
// unique constraint.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { SlideManifest, SlideType } from "@/lib/schema/slide";

// Matches the product requirement from 2026-05-19 — cap history
// at 10 entries per slide. Oldest pruned on insert. Tweak in one
// place if the policy changes.
export const MAX_VERSIONS_PER_SLIDE = 10;

type RegenSource = "regen" | "partial_regen";

function slideToJson(slide: SlideType): Prisma.InputJsonValue {
  // SlideType is just `{ slideId, role?, html }` — flat JSON-safe.
  // Cast is necessary because the Zod inferred type isn't structurally
  // assignable to InputJsonValue's recursive shape.
  return slide as unknown as Prisma.InputJsonValue;
}

/**
 * Seeds version 1 for every slide in a freshly-generated manifest.
 * Called from deck-generate's save step.
 *
 * On retry the upsert is a no-op for slides that already have state;
 * versions are only created inside the `create` branch so they don't
 * duplicate either.
 */
export async function seedSlideVersionsForInitialGeneration(
  prisma: PrismaClient,
  presentationId: string,
  manifest: SlideManifest,
): Promise<void> {
  for (const slide of manifest.slides) {
    await prisma.slideState.upsert({
      where: {
        presentationId_slideKey: {
          presentationId,
          slideKey: slide.slideId,
        },
      },
      create: {
        presentationId,
        slideKey: slide.slideId,
        currentVersionNumber: 1,
        versions: {
          create: {
            versionNumber: 1,
            slideJson: slideToJson(slide),
            source: "create",
          },
        },
      },
      // Retry-safe: if state already exists from a prior attempt,
      // do nothing. The version was created in the same upsert when
      // the row was first inserted.
      update: {},
    });
  }
}

/**
 * Records a new version for each regenerated slide. Bumps the
 * SlideState pointer and prunes the oldest versions if the slide's
 * history exceeds MAX_VERSIONS_PER_SLIDE.
 *
 * Lazy-creates SlideState rows for projects that pre-date the
 * versioning migration — those won't have a seeded v1, so the regen
 * becomes their v1 instead. The previous slide content isn't
 * recoverable for those legacy projects (it lived only in
 * PresentationVersion.slideJson), and that's an acceptable trade
 * since the feature is only meaningful going forward.
 */
export async function recordSlidePartialRegen(
  prisma: PrismaClient,
  presentationId: string,
  regeneratedSlides: SlideType[],
  source: RegenSource,
): Promise<void> {
  for (const slide of regeneratedSlides) {
    const state = await prisma.slideState.findUnique({
      where: {
        presentationId_slideKey: {
          presentationId,
          slideKey: slide.slideId,
        },
      },
      select: {
        id: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });

    if (!state) {
      // Legacy project — seed v1 = the regen output. Comment cache
      // is left untouched (null by default on create).
      await prisma.slideState.create({
        data: {
          presentationId,
          slideKey: slide.slideId,
          currentVersionNumber: 1,
          versions: {
            create: {
              versionNumber: 1,
              slideJson: slideToJson(slide),
              source,
            },
          },
        },
      });
      continue;
    }

    const nextVersionNumber = (state.versions[0]?.versionNumber ?? 0) + 1;

    await prisma.$transaction([
      prisma.slideVersion.create({
        data: {
          slideStateId: state.id,
          versionNumber: nextVersionNumber,
          slideJson: slideToJson(slide),
          source,
        },
      }),
      prisma.slideState.update({
        where: { id: state.id },
        data: { currentVersionNumber: nextVersionNumber },
      }),
    ]);

    // Prune oldest if over the cap. Using count + take(asc) so the
    // first version of the slide goes first — matches the natural
    // "scroll history newest-first, drop the tail" UX. Doesn't
    // protect locked versions (lock is a SlideState-level flag,
    // not a version-level flag — see schema comment).
    const total = await prisma.slideVersion.count({
      where: { slideStateId: state.id },
    });
    if (total > MAX_VERSIONS_PER_SLIDE) {
      const overflow = total - MAX_VERSIONS_PER_SLIDE;
      const oldest = await prisma.slideVersion.findMany({
        where: { slideStateId: state.id },
        orderBy: { versionNumber: "asc" },
        take: overflow,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await prisma.slideVersion.deleteMany({
          where: { id: { in: oldest.map((v) => v.id) } },
        });
      }
    }
  }
}
