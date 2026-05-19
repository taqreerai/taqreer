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
import { SlideManifestSchema, SlideSchema } from "@/lib/schema/slide";
import type { SlideManifest, SlideType } from "@/lib/schema/slide";

// Matches the product requirement from 2026-05-19 — cap history
// at 5 entries per slide. Oldest pruned on insert. Tweak in one
// place if the policy changes.
export const MAX_VERSIONS_PER_SLIDE = 5;

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

// ─── Slide history operations (Undo + Restore) ─────────────────────
// Both Undo and Restore PATCH the active PresentationVersion's
// slideJson by replacing ONE entry in the slides[] array with the
// stored content for a target SlideVersion. Lock + version pointer
// updates happen in the same transaction so a partial write can't
// leave the manifest and SlideState out of sync.
//
// Helper extracted so both routes (undo / restore) share the same
// splice + persistence logic; they differ only in (a) which target
// version they aim at and (b) whether the current version row is
// DELETED after the swap (undo discards it, restore keeps it).

type RestoreResult = {
  // Slide JSON that's now active for `slideKey` (mirrors what's in
  // PresentationVersion.slideJson after the splice).
  slide: SlideType;
  // New currentVersionNumber after the operation.
  currentVersionNumber: number;
};

async function spliceSlideIntoActiveManifest(
  prisma: PrismaClient,
  presentationId: string,
  slideKey: string,
  newSlide: SlideType,
): Promise<void> {
  // Read the active version pointer + its slideJson, splice the
  // target slide, write back. PresentationVersion.slideJson is the
  // canonical live deck — the renderer reads from here, not from
  // SlideVersion. The user-facing manifest needs the new content
  // RIGHT NOW (next render tick), not after the next regen.
  const presentation = await prisma.presentation.findUnique({
    where: { id: presentationId },
    select: { currentVersionId: true },
  });
  if (!presentation?.currentVersionId) {
    throw new Error("Presentation has no currentVersionId — can't splice");
  }
  const version = await prisma.presentationVersion.findUnique({
    where: { id: presentation.currentVersionId },
    select: { slideJson: true },
  });
  if (!version) throw new Error("currentVersionId points at a missing row");

  const parsed = SlideManifestSchema.safeParse(version.slideJson);
  if (!parsed.success) {
    throw new Error(
      `Active manifest failed schema validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
    );
  }
  const manifest = parsed.data;
  const slides = manifest.slides.map((s) =>
    s.slideId === slideKey ? newSlide : s,
  );
  // Re-validate the spliced manifest before writing so a malformed
  // SlideVersion payload (shouldn't happen in practice — Claude's
  // output is validated at write time — but defends against manual
  // DB edits) doesn't corrupt the live deck.
  const reparsed = SlideManifestSchema.safeParse({ ...manifest, slides });
  if (!reparsed.success) {
    throw new Error(
      `Spliced manifest failed schema validation: ${JSON.stringify(reparsed.error.issues).slice(0, 400)}`,
    );
  }
  await prisma.presentationVersion.update({
    where: { id: presentation.currentVersionId },
    data: { slideJson: reparsed.data as never },
  });
}

/**
 * Undo: deletes the slide's current SlideVersion row, steps the
 * pointer back to the next-lower versionNumber, and splices that
 * version's slideJson into the active manifest.
 *
 * No-ops (returns null) when there's no previous version — the
 * caller (route handler) translates this to a 400.
 *
 * Locked slides are NOT blocked here; the pill already prevents
 * Undo from firing on locked slides via the disabled affordance.
 * Server-side we treat lock as advisory for per-slide actions and
 * authoritative only for full-deck regen (per the product spec).
 */
export async function undoSlideVersion(
  prisma: PrismaClient,
  presentationId: string,
  slideKey: string,
): Promise<RestoreResult | null> {
  const state = await prisma.slideState.findUnique({
    where: { presentationId_slideKey: { presentationId, slideKey } },
    select: {
      id: true,
      currentVersionNumber: true,
    },
  });
  if (!state) return null;

  // Need the row at the CURRENT pointer + the row just below it
  // (in versionNumber order, ignoring gaps from earlier pruning).
  const [currentRow, previousRow] = await Promise.all([
    prisma.slideVersion.findUnique({
      where: {
        slideStateId_versionNumber: {
          slideStateId: state.id,
          versionNumber: state.currentVersionNumber,
        },
      },
      select: { id: true },
    }),
    prisma.slideVersion.findFirst({
      where: {
        slideStateId: state.id,
        versionNumber: { lt: state.currentVersionNumber },
      },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true, slideJson: true },
    }),
  ]);
  if (!currentRow || !previousRow) return null;

  const previousSlide = SlideSchema.safeParse(previousRow.slideJson);
  if (!previousSlide.success) {
    throw new Error(
      `Previous slide JSON failed validation: ${JSON.stringify(previousSlide.error.issues).slice(0, 400)}`,
    );
  }

  await prisma.$transaction([
    prisma.slideVersion.delete({ where: { id: currentRow.id } }),
    prisma.slideState.update({
      where: { id: state.id },
      data: { currentVersionNumber: previousRow.versionNumber },
    }),
  ]);
  await spliceSlideIntoActiveManifest(
    prisma,
    presentationId,
    slideKey,
    previousSlide.data,
  );

  return {
    slide: previousSlide.data,
    currentVersionNumber: previousRow.versionNumber,
  };
}

/**
 * Restore: jumps `SlideState.currentVersionNumber` to `targetVersionNumber`
 * (no deletion) and splices that version's slideJson into the active
 * manifest. Used by the History popover when the user picks a row.
 *
 * Returns null if the target version doesn't exist for the slide;
 * the caller maps that to a 400.
 */
export async function restoreSlideToVersion(
  prisma: PrismaClient,
  presentationId: string,
  slideKey: string,
  targetVersionNumber: number,
): Promise<RestoreResult | null> {
  const state = await prisma.slideState.findUnique({
    where: { presentationId_slideKey: { presentationId, slideKey } },
    select: { id: true, currentVersionNumber: true },
  });
  if (!state) return null;
  if (state.currentVersionNumber === targetVersionNumber) {
    // No-op: target already active. Still need to return a slide
    // payload so the client can keep the UI consistent.
    const row = await prisma.slideVersion.findUnique({
      where: {
        slideStateId_versionNumber: {
          slideStateId: state.id,
          versionNumber: targetVersionNumber,
        },
      },
      select: { slideJson: true },
    });
    if (!row) return null;
    const parsed = SlideSchema.safeParse(row.slideJson);
    if (!parsed.success) return null;
    return { slide: parsed.data, currentVersionNumber: targetVersionNumber };
  }

  const target = await prisma.slideVersion.findUnique({
    where: {
      slideStateId_versionNumber: {
        slideStateId: state.id,
        versionNumber: targetVersionNumber,
      },
    },
    select: { slideJson: true },
  });
  if (!target) return null;
  const parsed = SlideSchema.safeParse(target.slideJson);
  if (!parsed.success) {
    throw new Error(
      `Target slide JSON failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
    );
  }

  await prisma.slideState.update({
    where: { id: state.id },
    data: { currentVersionNumber: targetVersionNumber },
  });
  await spliceSlideIntoActiveManifest(
    prisma,
    presentationId,
    slideKey,
    parsed.data,
  );

  return {
    slide: parsed.data,
    currentVersionNumber: targetVersionNumber,
  };
}
