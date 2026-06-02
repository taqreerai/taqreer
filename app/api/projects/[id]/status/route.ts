import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { listWarmedGenids, publicGeneratedImageUrl } from "@/lib/images/store";

type Progress = {
  stage: "thinking" | "designing" | "validating" | "saving";
  currentSlide: number;
  estimatedTotal: number;
};

type SlideJson = {
  status?: string;
  slides?: unknown[];
  progress?: Progress;
  // Live per-slide preview written by deck-generate's streaming parser
  // as Claude closes each slide object. Ephemeral — overwritten by the
  // canonical `slides` array when the full validation pass completes.
  // Each entry is a partial Slide that already passed SlideSchema +
  // contains the raw HTML (DeckView sanitises at render via the same
  // SlideRenderer path the canonical slides use).
  streamingPreview?: unknown[];
  // Theme JSON captured mid-stream (always streams before slides in
  // the manifest). Drives the CSS-var wiring on the live preview
  // slides so palette / fonts / background resolve correctly before
  // the final manifest validates.
  streamingTheme?: unknown;
  // Direction + language echoed from the brief so the live-preview
  // SlideRenderer doesn't assume RTL/Arabic.
  streamingDirection?: unknown;
  streamingLanguage?: unknown;
  // Monotonic manifest-version token written by deck-generate. Strictly
  // non-decreasing across the lifetime of a versionId; bumped on parser
  // `didReset()` AND on every retry-attempt restart. DeckView uses it
  // to reject stale snapshots from out-of-order polls — closes the
  // race where an older poll arrives last and overwrites newer state
  // when both happen to carry the same `streamingPreview.length`.
  streamingManifestVersion?: unknown;
};

function getSlideJson(value: unknown): SlideJson | null {
  if (!value || typeof value !== "object") return null;
  return value as SlideJson;
}

function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stage === "string" &&
    typeof v.currentSlide === "number" &&
    typeof v.estimatedTotal === "number"
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Phase 15.A — view access required (poller runs for all viewers).
  const access = await resolveProjectAccess(id, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  // Optional ?versionId= — when provided, the poller wants the status of
  // a SPECIFIC version (e.g. the partial-regen target). Without it, two
  // close-together partial regens could let `take: 1` mask completion of
  // the version the client is actually waiting on.
  const url = new URL(request.url);
  const targetVersionId = url.searchParams.get("versionId");
  // Optional ?includeManifest=true — when truthy, callers receive the
  // latest completed version's full slide manifest in the response.
  // Used by DeckView's realtime broadcast handlers to swap canvas
  // content in-place after another viewer's regen lands, INSTEAD of
  // calling `router.refresh()` (which triggers a visible RSC re-render
  // cycle). Adds 30-200 KB to the response so it's strictly opt-in;
  // pollers that only need the progress/status payload don't pay the
  // cost.
  const includeManifest = url.searchParams.get("includeManifest") === "true";
  // Optional ?includeSlideStates=true — when truthy, the response
  // carries the per-slide pill state (lock + currentVersionNumber +
  // version history rows). Paired with includeManifest by realtime
  // broadcast handlers so a peer's regen lands with both the new
  // canvas AND the new metadata (lock pill bumps, history-popover
  // row prepends) in a single round-trip. Adds ~250 B per slide so
  // it's also opt-in; the polling path doesn't request it.
  const includeSlideStates = url.searchParams.get("includeSlideStates") === "true";
  // Optional ?includeImageFills=true — images-mode (context/images.md).
  // Returns a `{ genid: url }` map of every reserved box already filled by
  // gpt-image-2 on the latest version. DeckView seeds `filledImages` from
  // it on mount so an image that finalized while the client wasn't
  // listening (e.g. a `slide.image.ready` broadcast lost in the
  // `/preview`→`/project` navigation gap — broadcasts have no replay)
  // still swaps in, no reload. Cheap (2 columns, indexed by version);
  // opt-in so the idle progress poll doesn't pay for it.
  const includeImageFills = url.searchParams.get("includeImageFills") === "true";
  const versionsQuery = targetVersionId
    ? {
        where: { id: targetVersionId },
        take: 1,
        select: { id: true, status: true, slideJson: true },
      }
    : {
        orderBy: { versionNumber: "desc" as const },
        take: 1,
        select: { id: true, status: true, slideJson: true },
      };
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      status: true,
      presentation: {
        select: {
          // `id` needed only on the includeSlideStates path — selected
          // unconditionally to keep the query shape simple; the column
          // is a cuid, negligible payload.
          id: true,
          versions: versionsQuery,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const latestVersion = project.presentation?.versions[0];
  // When the caller pinned to a specific versionId but no row matches,
  // return 404 — leaving the poller to spin forever with `versionId:
  // null` is ambiguous (the apply-poller can't tell "version was
  // never created" from "version not ready yet"). Failing fast lets
  // the disconnect detector pick this up immediately.
  if (targetVersionId && !latestVersion) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  const slideJson = getSlideJson(latestVersion?.slideJson);
  const slideCount = Array.isArray(slideJson?.slides) ? slideJson.slides.length : 0;
  const inferredStatus =
    project.status === "failed"
      ? "failed"
      : project.status === "complete" || project.status === "completed"
        ? project.status
        : latestVersion?.status === "completed" || slideJson?.status === "complete"
          ? "complete"
          : project.status;

  const progress = isProgress(slideJson?.progress) ? slideJson.progress : null;
  // Pass the live preview array through unchanged. Shape is asserted to
  // be an array; further validation happens at render time in DeckView.
  // Capped to a defensive 60 entries so a runaway parser can't blow up
  // the polling response.
  const streamingPreview = Array.isArray(slideJson?.streamingPreview)
    ? slideJson.streamingPreview.slice(0, 60)
    : null;
  const streamingTheme =
    slideJson?.streamingTheme && typeof slideJson.streamingTheme === "object"
      ? slideJson.streamingTheme
      : null;
  // String-narrow the direction + language to the two valid values
  // each accepts; anything else collapses to null and DeckView falls
  // back to its own default (which currently matches the brief's
  // hard-default of RTL/Arabic).
  const streamingDirection =
    slideJson?.streamingDirection === "rtl" || slideJson?.streamingDirection === "ltr"
      ? slideJson.streamingDirection
      : null;
  const streamingLanguage =
    slideJson?.streamingLanguage === "ar" || slideJson?.streamingLanguage === "en"
      ? slideJson.streamingLanguage
      : null;
  // Coerce the monotonic version token. Default 0 keeps older in-flight
  // runs / non-enhance flows safe — clients should treat "missing" as
  // "no version info, fall back to legacy length-only guard" rather
  // than "version 0, reject everything".
  const streamingManifestVersion =
    typeof slideJson?.streamingManifestVersion === "number" &&
    Number.isFinite(slideJson.streamingManifestVersion)
      ? slideJson.streamingManifestVersion
      : null;

  // Include the FULL slide manifest on the response in either of two cases:
  //
  //   1. Caller pinned a versionId AND that version is completed.
  //      DeckView's partial-regen poll-success path uses this to swap
  //      the spliced slides in WITHOUT needing Supabase Realtime
  //      (local docker Postgres doesn't publish to it) AND WITHOUT
  //      relying on `router.refresh()` to repopulate RSC cleanly.
  //      Poll loop stops after first "completed" response, so this
  //      manifest payload is sent at most once per regen.
  //
  //   2. Caller passed `?includeManifest=true` AND the latest version
  //      is completed. Broadcast handlers use this to swap canvas
  //      content in-place when a peer's regen lands. They don't pin
  //      because they don't know the target versionId — they just
  //      want "give me whatever's current."
  //
  // Returned unchanged; DeckView re-validates with SlideManifestSchema
  // before calling setManifest.
  const manifest =
    latestVersion?.status === "completed" &&
    (targetVersionId || includeManifest)
      ? slideJson
      : null;

  // Per-slide pill state. Mirrors the SSR-hydration shape in
  // `lib/project/load-project.ts:200-235` so DeckView's broadcast
  // handlers can drop the response into `setSlideStates` /
  // `setHistoryVersions` without any client-side reshaping. Only
  // fired on opt-in; idle pollers don't pay the round-trip.
  let slideStates: Array<{
    slideKey: string;
    currentVersionNumber: number;
    lockedAt: string | null;
    hasCachedComments: boolean;
    versions: Array<{
      versionNumber: number;
      source: string;
      createdAt: string;
    }>;
  }> | null = null;
  if (includeSlideStates && project.presentation?.id) {
    const states = await prisma.slideState.findMany({
      where: { presentationId: project.presentation.id },
      select: {
        slideKey: true,
        currentVersionNumber: true,
        lockedAt: true,
        cachedComments: true,
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
    slideStates = states.map((s) => ({
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

  // Ready image fills for the latest version, keyed genid → public URL.
  // Two sources, unioned:
  //   1. GeneratedImage rows the reconcile (`deck-images-generate`) marks
  //      `ready` — the durable, post-completion source.
  //   2. WARM images stored mid-stream by `deck-image-warm`, which writes the
  //      object to `${projectId}/gen/` but NO DB row (the reconcile backfills
  //      rows later). Without surfacing these, the live-fill poll is blind to
  //      warm images the whole time the deck generates — broadcasts are the
  //      only other delivery path and they don't replay / don't arrive in
  //      local dev, so images only showed up after a manual refresh. Public
  //      URLs are deterministic and identical to what the reconcile bakes into
  //      the manifest, so the union never churns the rendered slide.
  let imageFills: Record<string, string> | null = null;
  if (includeImageFills) {
    imageFills = {};
    // The two sources are independent — read them concurrently (this runs on
    // the every-6s image-fills poll, per viewer).
    //   1. `ready` GeneratedImage rows — authoritative, post-reconcile.
    //   2. EVERY warm image stored under `${projectId}/gen/`. We deliberately do
    //      NOT scope this to the genids in `streamingPreview`: that set
    //      fluctuates on a mid-stream re-advance/reset, and scoping to it would
    //      RETRACT an image the client was already shown (observed live). A
    //      superset is safe — a slide only renders a genid it contains, and the
    //      client poll measures coverage against ITS OWN rendered boxes (not
    //      this list), so extras never end the poll early. Never-retract +
    //      client-side own-box filtering is what makes a mid-deck image land
    //      live instead of waiting for the end.
    const [ready, warmed] = await Promise.all([
      latestVersion?.id
        ? prisma.generatedImage.findMany({
            where: {
              presentationVersionId: latestVersion.id,
              status: "ready",
              storageUrl: { not: null },
            },
            select: { genid: true, storageUrl: true },
          })
        : Promise.resolve(
            [] as { genid: string; storageUrl: string | null }[],
          ),
      listWarmedGenids(id).catch((err) => {
        // Storage-list blip — DB-ready fills are still returned. Log it (every
        // other image path logs its failures) so a persistent failure that
        // would silently break live fill in dev isn't invisible.
        console.warn(
          `[status] listWarmedGenids failed for ${id}:`,
          err instanceof Error ? err.message : String(err),
        );
        return [] as string[];
      }),
    ]);
    for (const r of ready) {
      if (r.storageUrl) imageFills[r.genid] = r.storageUrl;
    }
    for (const genid of warmed) {
      if (!imageFills[genid]) {
        imageFills[genid] = publicGeneratedImageUrl(id, genid);
      }
    }
  }

  return NextResponse.json({
    status: inferredStatus,
    slideCount,
    progress,
    streamingPreview,
    streamingManifestVersion,
    streamingTheme,
    streamingDirection,
    streamingLanguage,
    imageFills,
    // Latest version id + its own status. DeckView's partial-regen polling
    // uses this to distinguish "applying is done" (versionId == the new
    // version's id AND status=completed) from "you're still looking at the
    // pre-apply version" (versionId == source).
    versionId: latestVersion?.id ?? null,
    versionStatus: latestVersion?.status ?? null,
    manifest,
    slideStates,
  });
}
