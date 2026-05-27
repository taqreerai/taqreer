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
  /**
   * True when the user picked "auto" slide-count (let Claude decide);
   * false when they pinned an explicit number. Drives the generating-
   * state slide-nav strategy in DeckView — auto mode shows an empty
   * sidebar that grows tile-by-tile with a trailing "still working"
   * placeholder, custom mode shows the user-picked N up-front.
   *
   * Defaults to true for legacy briefs that predate the `mode` field
   * — see `readSlideCountAuto` for the fallback logic.
   */
  initialSlideCountAuto: boolean;
  /**
   * Which create flow produced this brief ("scratch" / "enhance" /
   * "mimic" / "data"), or null for legacy briefs without a `source`
   * field. Drives the generating-state status copy so the message
   * reflects what's actually happening — /enhance reads "extracting
   * text + brand" honestly, but /datasheet has no PDF and shouldn't
   * lie about extraction.
   */
  initialSourceKind: FlowSourceKind | null;
  initialSlideStates: InitialSlideState[];
  // Slide aspect ratio chosen on /create/brand. Used as the fallback for
  // the generating-state placeholder grid (when the manifest isn't ready
  // yet) so the cards have the correct orientation from the first paint.
  initialFormat: SlideFormat;
  /**
   * Reload-defense for partial-slide regen (2026-05-27). When a Job
   * row of type `deck.regenerate.partial` is still in flight (status:
   * queued / processing / running), this carries the target slide
   * IDs + the new version's id so DeckView can pre-seed `applying`
   * on mount and the regenerating-slide overlay survives the
   * browser reload. The apply-poller already handles cleanup once
   * the regen lands; this just restores the in-flight state.
   *
   * Null when no partial regen is active (the common case).
   */
  initialActiveRegen: {
    versionId: string;
    targetSlideIds: string[];
  } | null;
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

// Which create flow produced this brief — drives the generating-
// state copy in DeckView (e.g. "extracting text + brand" reads
// honestly for /enhance but is misleading for /datasheet, where
// there's no PDF and the data was already parsed before submit).
// Returns null for legacy briefs without a `source.kind` field or
// for plain /create scratch text (no source means the default
// "starting design" copy applies).
export type FlowSourceKind = "scratch" | "enhance" | "mimic" | "data";

function readSourceKind(aiPrompt: string | null): FlowSourceKind | null {
  if (!aiPrompt) return null;
  try {
    const parsed = JSON.parse(aiPrompt) as {
      source?: { kind?: string };
    };
    const kind = parsed?.source?.kind;
    if (
      kind === "scratch" ||
      kind === "enhance" ||
      kind === "mimic" ||
      kind === "data"
    ) {
      return kind;
    }
  } catch {
    /* aiPrompt is best-effort */
  }
  return null;
}

// Did the user opt into "auto" slide-count (let Claude pick) or pick
// an explicit number? Read from the same aiPrompt JSON shape the
// create flows write. Defaults to `true` (auto) — legacy briefs
// without the `brand.slideCount.mode` field land here as auto, which
// matches their original UI semantics (no count chip on the brief).
//
// Used by DeckView's generating branch: in auto mode the sidebar
// starts empty and grows tile-by-tile with a trailing "still working"
// placeholder; in custom mode it shows the user-picked N placeholders
// up-front and fills them as Claude finishes each slide.
function readSlideCountAuto(aiPrompt: string | null): boolean {
  if (!aiPrompt) return true;
  try {
    const parsed = JSON.parse(aiPrompt) as {
      slideCount?: number | null;
      brand?: { slideCount?: { mode?: string; value?: number | null } };
    };
    // Explicit mode signal wins — that's what /create + /enhance +
    // /mimic + /datasheet write.
    const mode = parsed?.brand?.slideCount?.mode;
    if (mode === "custom") return false;
    if (mode === "auto") return true;
    // Legacy briefs without `mode` — fall back to "is the count
    // pinned anywhere?". If yes, treat as custom; otherwise auto.
    if (typeof parsed?.slideCount === "number" && parsed.slideCount > 0) {
      return false;
    }
    if (
      typeof parsed?.brand?.slideCount?.value === "number" &&
      parsed.brand.slideCount.value > 0
    ) {
      return false;
    }
  } catch {
    /* aiPrompt is best-effort */
  }
  return true;
}

// Reload-defense lookup for partial-slide regen. Returns the target
// slide IDs + target version id when a `deck.regenerate.partial`
// Job is still in flight (status ∈ active set), or null when no
// regen is active. The active-status set mirrors the cancel
// route's `ACTIVE_JOB_STATUSES` — kept in sync because both
// callers use it to decide "is this run still alive".
//
// `inputJson` is a Prisma `Json` column (unschemata'd at the DB
// layer), so every field gets defensively narrowed. A malformed
// historical row collapses to null — the overlay just won't
// restore rather than crashing the project load.
async function readActiveRegen(
  projectId: string,
): Promise<InitialState["initialActiveRegen"]> {
  const activeJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: "deck.regenerate.partial",
      status: { in: ["queued", "processing", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { inputJson: true },
  });
  if (!activeJob?.inputJson || typeof activeJob.inputJson !== "object") {
    return null;
  }
  const input = activeJob.inputJson as {
    versionId?: unknown;
    targetSlideIds?: unknown;
  };
  const versionId =
    typeof input.versionId === "string" ? input.versionId : null;
  const targetSlideIds = Array.isArray(input.targetSlideIds)
    ? input.targetSlideIds.filter((v): v is string => typeof v === "string")
    : [];
  if (!versionId || targetSlideIds.length === 0) return null;
  return { versionId, targetSlideIds };
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
  const initialSlideCountAuto = readSlideCountAuto(project.aiPrompt);
  const initialSourceKind = readSourceKind(project.aiPrompt);

  const initialFormat: SlideFormat = project.format === "9:16" ? "9:16" : "16:9";

  // Partial-regen reload defense — look up the newest non-terminal
  // Job for this project of type `deck.regenerate.partial` and
  // rehydrate its target slide IDs + target version id. See
  // `readActiveRegen` for the defensive narrowing rationale.
  const initialActiveRegen = await readActiveRegen(projectId);

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
    initialSlideCountAuto,
    initialSourceKind,
    initialSlideStates,
    initialFormat,
    initialActiveRegen,
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
