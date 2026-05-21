// Shared project-load helper for the two routes that view a deck:
//   • /preview/[id]  — generation phase (deck is mid-streaming)
//   • /project/[id]  — working session (deck is completed)
//
// Both routes need the same hydration payload — title, status,
// version pointer, manifest, slide states — so the loader lives
// here and is imported by each route's server component. Each
// route then adds its own redirect rule on top (preview → project
// when completed; project → preview when not). Keeping the loader
// shared means a future schema add (new column on Project /
// Presentation / Version) needs one edit, not two.
//
// Previously this lived inline in `app/(app)/preview/[projectId]/
// page.tsx`. Extracted 2026-05-21 as part of the /preview ↔
// /project route split.

import { prisma } from "@/lib/prisma";
import {
  SlideManifestSchema,
  type SlideManifest,
  type SlideFormat,
} from "@/lib/schema/slide";

// Per-slide state shared with DeckView for the pill (lock badge,
// undo affordance, version count, cached comments). Stays a flat
// serialisable shape so it can cross the server→client boundary
// without re-fetching client-side.
//
// `versions` is preloaded so the History popover opens already
// populated — opening it with `historyVersions[key] ?? []`
// previously rendered an empty list for one frame before the
// /versions fetch completed, then the list expanded as rows
// appeared (the "0 rows → expand → glitch" the user flagged
// 2026-05-20).
export type InitialSlideVersion = {
  versionNumber: number;
  source: string; // "create" | "regen" | "partial_regen" | "restore"
  createdAt: string; // ISO
};

export type InitialSlideState = {
  slideKey: string;
  currentVersionNumber: number;
  hasCachedComments: boolean;
  lockedAt: string | null;
  // Optional — only populated on the SSR-hydration path so the
  // client can seed `historyVersions` and skip the first-open
  // fetch. Runtime mutations that construct a fresh slide state
  // (optimistic restore, lock toggle) omit it; the cache lives
  // in DeckView's `historyVersions` map, not on each row.
  versions?: InitialSlideVersion[];
};

export type InitialState = {
  projectTitle: string;
  presentationId: string | null;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  initialVersionId: string | null;
  // Pinned canonical version (set by Save Project). Null when
  // the project has never been saved. Compared against
  // initialVersionId in the Save button to drive its saved /
  // unsaved indicator.
  initialSavedVersionId: string | null;
  // Per-slide snapshot taken at save time — { slideKey → versionNumber }.
  // Drives the second half of the saved/unsaved comparison (the first
  // half is currentVersionId === savedVersionId). Needed because
  // per-slide restore mutates PresentationVersion.slideJson in place,
  // leaving the version pointer untouched. Null when never saved or
  // when an older save row didn't populate it.
  initialSavedSlideVersions: Record<string, number> | null;
  initialManifest: SlideManifest | null;
  initialSlideCount: number;
  initialSlideStates: InitialSlideState[];
  // Slide aspect ratio chosen on /create/brand. Used as the fallback for
  // the generating-state placeholder grid (when the manifest isn't ready
  // yet) so the cards have the correct orientation from the first paint.
  initialFormat: SlideFormat;
};

// Normalises Presentation.savedSlideVersions JSON into a
// Record<slideKey, versionNumber>. The column is Prisma `Json`, so the
// value lands as `unknown` — guard each entry, drop anything malformed
// rather than throwing (legacy saves before the column existed land as
// null, which we collapse to null too).
function parseSavedSlideVersions(
  value: unknown,
): Record<string, number> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Saved-slide-version numbers are 1-indexed positive integers
    // (see SlideState.currentVersionNumber). Fractional or negative
    // values shouldn't reach this Json column — but if a corrupt
    // payload ever lands here, accepting it would skew the
    // saved/unsaved comparator in DeckView (which does an
    // equality check against live SlideState.currentVersionNumber,
    // also an integer). Narrow to non-negative integers; anything
    // off-axis gets silently dropped from the snapshot.
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      result[k] = v;
    }
  }
  return result;
}

function readSlideCountHint(aiPrompt: string | null): number | null {
  if (!aiPrompt) return null;
  try {
    const parsed = JSON.parse(aiPrompt) as {
      slideCount?: number | null;
      brand?: { slideCount?: { value?: number | null } };
    };
    const direct = parsed?.slideCount;
    if (typeof direct === "number" && direct > 0) return direct;
    const fromBrand = parsed?.brand?.slideCount?.value;
    if (typeof fromBrand === "number" && fromBrand > 0) return fromBrand;
  } catch {
    /* aiPrompt is best-effort */
  }
  return null;
}

export async function loadProject(
  projectId: string,
): Promise<InitialState | null> {
  // Read the version pointed to by `presentation.currentVersionId` (not the
  // numerically-latest version). During partial regen we deliberately leave
  // currentVersionId on the previous completed version so the deck stays
  // VISIBLE while a subset of slides regenerates — only the Inngest handler
  // flips currentVersionId once the new version is complete. For full regen
  // currentVersionId IS flipped to the queued version at API time, so the
  // generating UI surfaces normally. Fall back to the numerically-latest
  // version when currentVersionId is null (first generation, before the
  // create-project flow has set it).
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      status: true,
      aiPrompt: true,
      // `format` was written at /api/projects creation time from
      // payload.brand.slideSize ("16:9" or "9:16"). Used here so the
      // generating-state placeholder grid in DeckView shows the correct
      // orientation BEFORE the manifest finishes streaming.
      format: true,
      presentation: {
        select: {
          id: true,
          currentVersionId: true,
          // Pinned canonical version pointer (set by the
          // "حفظ المشروع" toolbar action). Used to drive the
          // Save button's saved/unsaved indicator.
          savedVersionId: true,
          // Per-slide snapshot taken at save time — drives the
          // restore-aware portion of the saved/unsaved check.
          savedSlideVersions: true,
        },
      },
    },
  });
  if (!project) return null;

  const currentVersionId = project.presentation?.currentVersionId ?? null;
  const version = currentVersionId
    ? await prisma.presentationVersion.findUnique({
        where: { id: currentVersionId },
        select: { id: true, status: true, slideJson: true },
      })
    : await prisma.presentationVersion.findFirst({
        where: { presentationId: project.presentation?.id ?? "" },
        orderBy: { versionNumber: "desc" },
        select: { id: true, status: true, slideJson: true },
      });

  let manifest: SlideManifest | null = null;
  if (version?.slideJson && version.status === "completed") {
    const parsed = SlideManifestSchema.safeParse(version.slideJson);
    if (parsed.success) manifest = parsed.data;
  }

  let initialSlideCount = 6;
  const hint = readSlideCountHint(project.aiPrompt);
  if (hint) initialSlideCount = hint;
  if (version?.slideJson && typeof version.slideJson === "object") {
    const slides = (version.slideJson as { slides?: unknown[] }).slides;
    if (Array.isArray(slides) && slides.length > 0) initialSlideCount = slides.length;
  }

  const initialFormat: SlideFormat = project.format === "9:16" ? "9:16" : "16:9";

  // Per-slide state for the pill (lock + version count + cached
  // comments). Only fetched when we have a presentation row;
  // legacy projects without a presentation skip this entirely.
  // `hasCachedComments` is a boolean (not the payload) — the
  // payload itself only travels to the server when "Try again"
  // fires (step 6).
  let initialSlideStates: InitialSlideState[] = [];
  if (project.presentation?.id) {
    const states = await prisma.slideState.findMany({
      where: { presentationId: project.presentation.id },
      select: {
        slideKey: true,
        currentVersionNumber: true,
        lockedAt: true,
        cachedComments: true,
        // Versions are bounded (MAX_VERSIONS_PER_SLIDE = 5) so
        // serialising them inline adds at most ~250 B per slide
        // to the page payload — well worth eliminating the
        // first-open glitch. Newest-first so the popover
        // doesn't need to re-sort client-side.
        versions: {
          orderBy: { versionNumber: "desc" },
          select: {
            versionNumber: true,
            source: true,
            createdAt: true,
          },
        },
      },
    });
    initialSlideStates = states.map((s) => ({
      slideKey: s.slideKey,
      currentVersionNumber: s.currentVersionNumber,
      lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
      hasCachedComments: s.cachedComments != null,
      versions: s.versions.map((v) => ({
        versionNumber: v.versionNumber,
        source: v.source,
        createdAt: v.createdAt.toISOString(),
      })),
    }));
  }

  return {
    projectTitle: project.title,
    presentationId: project.presentation?.id ?? null,
    initialProjectStatus: project.status,
    initialVersionStatus: version?.status ?? null,
    initialVersionId: version?.id ?? null,
    initialSavedVersionId: project.presentation?.savedVersionId ?? null,
    initialSavedSlideVersions: parseSavedSlideVersions(
      project.presentation?.savedSlideVersions ?? null,
    ),
    initialManifest: manifest,
    initialSlideCount,
    initialSlideStates,
    initialFormat,
  };
}

// Shorthand status check the route guards use to decide which side
// of the /preview ↔ /project split a project belongs on. A "ready"
// deck (= completed) lives at /project; anything else (generating,
// queued, partial-regen mid-stream, never-generated) lives at
// /preview.
export function isDeckReady(state: InitialState): boolean {
  return state.initialVersionStatus === "completed";
}
