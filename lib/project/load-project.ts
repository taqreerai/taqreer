// Project-load helper for the Studio route (/project/[id]) that views a deck.
// Both the generation phase (deck mid-streaming) and the working session (deck
// completed) mount there, so one loader returns the full hydration payload:
// title, status, version pointer, manifest, slide states. The route's server
// component passes that payload to DeckView. Keeping it in one place means a
// future schema add (new column on Project / Presentation / Version) needs one
// edit, not a copy per surface.

import { prisma } from "@/lib/prisma";
import {
  SlideManifestSchema,
  SLIDE_FORMATS,
  type SlideManifest,
  type SlideFormat,
} from "@/lib/schema/slide";
import { hydrateManifestImages } from "@/lib/images/hydrate-manifest";
import { isPaidPlan } from "@/lib/plan";

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
  source: string; // "create" | "regen" | "partial_regen" | "restore" | "manual_edit"
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
  // Social flow (Project.type === "social"): a Claude deck at social ratios.
  // Drives the export lock (PDF/PNG only, any ratio) + "post" studio copy.
  initialIsSocial: boolean;
  /**
   * Free-tier branding (2026-07-13): true when the deck OWNER is on the
   * free plan (admins exempt). DeckView renders the "Designed by
   * taqreer.ai" watermark over the canvas - a render-time overlay only,
   * never part of the stored slide HTML, gated on the owner's plan (not
   * the viewer's) so upgrading removes it from all the owner's decks.
   */
  brandingWatermark: boolean;
  /**
   * Teaser paywall (free-tier conversion). `teaserLockedCount` is the
   * number of locked slots this deck was created with (0 for paid/admin
   * decks); `teaserUnlocked` flips true once the owner subscribes and the
   * withheld slides are generated. The viewer appends
   * `teaserUnlocked ? 0 : teaserLockedCount` blurred locked slots after the
   * real slides. Never part of slideJson, so exports / bake / gallery ignore
   * it by construction.
   */
  teaserLockedCount: number;
  teaserUnlocked: boolean;
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

// Cross-flow brief shape persisted as JSON on `Project.aiPrompt`.
// Only the fields the loader actually reads are typed — every entry
// is optional because the column is unschemata'd at the DB layer,
// and three different create flows (scratch / enhance / mimic /
// data) write subtly different payloads. Narrow lives in
// `parseAiPrompt` below.
export type FlowSourceKind = "scratch" | "enhance" | "mimic" | "data";
type AiPromptShape = {
  slideCount?: number | null;
  source?: { kind?: string };
  brand?: {
    slideCount?: { mode?: string; value?: number | null };
  };
};

// Parse `Project.aiPrompt` into the narrow `AiPromptShape` once per
// request. Returns null on JSON parse failure (the column is
// best-effort — legacy / partially-written rows fall back to
// per-reader defaults). Callers should reuse the returned object
// across multiple readers instead of re-parsing the string three
// times — that was the pattern this file had before the 2026-05-27
// simplifier pass.
function parseAiPrompt(aiPrompt: string | null): AiPromptShape | null {
  if (!aiPrompt) return null;
  try {
    return JSON.parse(aiPrompt) as AiPromptShape;
  } catch {
    return null;
  }
}

function readSlideCountHint(prompt: AiPromptShape | null): number | null {
  if (!prompt) return null;
  const direct = prompt.slideCount;
  if (typeof direct === "number" && direct > 0) return direct;
  const fromBrand = prompt.brand?.slideCount?.value;
  if (typeof fromBrand === "number" && fromBrand > 0) return fromBrand;
  return null;
}

// Which create flow produced this brief — drives the generating-
// state copy in DeckView (e.g. "extracting text + brand" reads
// honestly for /enhance but is misleading for /datasheet, where
// there's no PDF and the data was already parsed before submit).
// Returns null for legacy briefs without a `source.kind` field or
// for plain /create scratch text (no source means the default
// "starting design" copy applies).
function readSourceKind(
  prompt: AiPromptShape | null,
): FlowSourceKind | null {
  const kind = prompt?.source?.kind;
  if (
    kind === "scratch" ||
    kind === "enhance" ||
    kind === "mimic" ||
    kind === "data"
  ) {
    return kind;
  }
  return null;
}

// Did the user opt into "auto" slide-count (let Claude pick) or pick
// an explicit number? Reads the same `AiPromptShape` the create
// flows write. Defaults to `true` (auto) — legacy briefs without
// the `brand.slideCount.mode` field land here as auto, which matches
// their original UI semantics (no count chip on the brief).
//
// Used by DeckView's generating branch: in auto mode the sidebar
// starts empty and grows tile-by-tile with a trailing "still working"
// placeholder; in custom mode it shows the user-picked N placeholders
// up-front and fills them as Claude finishes each slide.
function readSlideCountAuto(prompt: AiPromptShape | null): boolean {
  if (!prompt) return true;
  // Explicit mode signal wins — that's what /create + /enhance +
  // /mimic + /datasheet write.
  const mode = prompt.brand?.slideCount?.mode;
  if (mode === "custom") return false;
  if (mode === "auto") return true;
  // Legacy briefs without `mode` — fall back to "is the count pinned
  // anywhere?". If yes, treat as custom; otherwise auto.
  if (typeof prompt.slideCount === "number" && prompt.slideCount > 0) {
    return false;
  }
  const fromBrand = prompt.brand?.slideCount?.value;
  if (typeof fromBrand === "number" && fromBrand > 0) return false;
  return true;
}

// Defensive narrow for `version.slideJson.slides.length`. Returns
// the count when the manifest already has slides written (a
// completed or partially-streamed version), or null when the
// version is empty / unparsed.
function readManifestSlideCount(slideJson: unknown): number | null {
  if (!slideJson || typeof slideJson !== "object") return null;
  const slides = (slideJson as { slides?: unknown }).slides;
  if (!Array.isArray(slides) || slides.length === 0) return null;
  return slides.length;
}

// Initial-slide-count priority: manifest length (whatever Claude
// actually produced) > prompt hint (user-picked or auto-estimated)
// > 6 (placeholder default). Explicit early returns make the
// precedence visible at a glance — previously the same shape was
// hidden in a 3-step `let initialSlideCount = ...` mutation.
function resolveInitialSlideCount(
  slideJson: unknown,
  prompt: AiPromptShape | null,
): number {
  const fromManifest = readManifestSlideCount(slideJson);
  if (fromManifest !== null) return fromManifest;
  // AUTO mode: the prompt's slideCount is the tier CEILING, not a real
  // count (2026-07-18). Seeding it would flash the whole cap; the model
  // declares its intended total on the cover and the progress poll fills
  // it in. Neutral default until then. Custom picks keep their hint.
  if (readSlideCountAuto(prompt)) return 6;
  const hint = readSlideCountHint(prompt);
  if (hint !== null) return hint;
  return 6;
}

// Narrow the project's stored `format` string to the
// `SlideFormat` union. Anything outside the union (including null)
// collapses to `16:9`. Tiny helper, but matches the file's
// "narrowing lives in a named helper" convention.
function narrowFormat(value: string | null): SlideFormat {
  return SLIDE_FORMATS.includes(value as SlideFormat)
    ? (value as SlideFormat)
    : "16:9";
}

// Load the version DeckView should mount on. Priority is the
// presentation's pinned `currentVersionId` (partial regen leaves
// this on the previously-completed version so the deck stays
// visible mid-stream); falls back to the numerically-latest version
// when no pointer is set (first generation, before /api/projects
// has run the post-tx update). Returns null when there's no
// presentation row at all — earlier this called
// `findFirst({ presentationId: ... ?? "" })` which would execute a
// guaranteed-empty query; short-circuiting here avoids the round-trip.
async function loadCurrentVersion(
  presentation: {
    id: string;
    currentVersionId: string | null;
  } | null,
): Promise<{ id: string; status: string; slideJson: unknown } | null> {
  if (!presentation) return null;
  if (presentation.currentVersionId) {
    return prisma.presentationVersion.findUnique({
      where: { id: presentation.currentVersionId },
      select: { id: true, status: true, slideJson: true },
    });
  }
  return prisma.presentationVersion.findFirst({
    where: { presentationId: presentation.id },
    orderBy: { versionNumber: "desc" },
    select: { id: true, status: true, slideJson: true },
  });
}

// Per-slide state for the pill (lock + version count + cached
// comments). Returns `[]` when there's no presentation row (legacy
// projects that pre-date the versioning migration). Versions are
// bounded (MAX_VERSIONS_PER_SLIDE = 5) so serialising them inline
// adds at most ~250 B per slide to the page payload — well worth
// eliminating the popover's first-open glitch. Newest-first so the
// client doesn't re-sort.
async function loadInitialSlideStates(
  presentationId: string | null,
): Promise<InitialSlideState[]> {
  if (!presentationId) return [];
  const states = await prisma.slideState.findMany({
    where: { presentationId },
    select: {
      slideKey: true,
      currentVersionNumber: true,
      lockedAt: true,
      cachedComments: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        // Cap defensively at MAX_VERSIONS_PER_SLIDE. The insert path
        // already enforces this bound on writes via rotation, but a
        // long-lived deck pre-dating that rotation could carry more
        // rows in storage — explicitly capping the read keeps the
        // SSR payload size in line with what the surrounding comment
        // documents. CR #3 (PR #40).
        take: 5,
        select: {
          versionNumber: true,
          source: true,
          createdAt: true,
        },
      },
    },
  });
  return states.map((s) => ({
    slideKey: s.slideKey,
    currentVersionNumber: s.currentVersionNumber,
    lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
    // `hasCachedComments` is a boolean (not the payload) — the
    // payload itself only travels to the server when "Try again"
    // fires (step 6).
    hasCachedComments: s.cachedComments != null,
    versions: s.versions.map((v) => ({
      versionNumber: v.versionNumber,
      source: v.source,
      createdAt: v.createdAt.toISOString(),
    })),
  }));
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
      // Ignore DEAD jobs. A partial regen finishes in well under a minute; a job
      // still "active" after 15 min is orphaned — e.g. the worker was killed
      // before its onFailure hook could mark it failed. Without this guard such
      // a row re-arms the regen overlay on EVERY page load, forever (the client
      // superseded-clear then has to mop it up each load). reported 2026-06-07.
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
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
      // Flow discriminator: "social" projects export PDF/PNG only.
      type: true,
      // Owner plan + role for the free-tier branding watermark (see
      // InitialState.brandingWatermark).
      user: { select: { plan: true, role: true } },
      // Teaser paywall: locked-slot count + unlock timestamp (see
      // InitialState.teaserLockedCount / teaserUnlocked).
      teaserLockedCount: true,
      teaserUnlockedAt: true,
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

  // Parse `aiPrompt` ONCE — every `readX(prompt)` reader below
  // shares the result instead of re-parsing the same string three
  // times.
  const prompt = parseAiPrompt(project.aiPrompt);

  const version = await loadCurrentVersion(project.presentation ?? null);

  let manifest: SlideManifest | null = null;
  if (version?.slideJson && version.status === "completed") {
    const parsed = SlideManifestSchema.safeParse(version.slideJson);
    // Re-inject ready generated-image src's the durable slideJson may be
    // missing (flatten/edit race — see hydrateManifestImages). Without this
    // a reload before `filledImages` repopulates would show a shimmer in the
    // editor and export imageless PPTX/HTML. Mid-session the client covers it
    // via the status route's imageFills merge.
    if (parsed.success) {
      manifest = await hydrateManifestImages(projectId, version.id, parsed.data);
    }
  }

  const initialActiveRegen = await readActiveRegen(projectId);
  const initialSlideStates = await loadInitialSlideStates(
    project.presentation?.id ?? null,
  );

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
    initialSlideCount: resolveInitialSlideCount(version?.slideJson, prompt),
    initialSlideCountAuto: readSlideCountAuto(prompt),
    initialSourceKind: readSourceKind(prompt),
    initialSlideStates,
    initialFormat: narrowFormat(project.format),
    initialIsSocial: project.type === "social",
    initialActiveRegen,
    brandingWatermark:
      !isPaidPlan(project.user.plan) && project.user.role !== "admin",
    teaserLockedCount: project.teaserLockedCount,
    teaserUnlocked: project.teaserUnlockedAt != null,
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
