import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  SlideManifestSchema,
  type SlideManifest,
  type SlideFormat,
} from "@/lib/schema/slide";
import { DeckView } from "@/components/preview/DeckView";

export const dynamic = "force-dynamic";

// Per-slide state shared with DeckView for the pill (lock badge,
// undo affordance, version count, cached comments). Stays a flat
// serialisable shape so it can cross the server→client boundary
// without re-fetching client-side.
export type InitialSlideState = {
  slideKey: string;
  currentVersionNumber: number;
  hasCachedComments: boolean;
  lockedAt: string | null;
};

type InitialState = {
  projectTitle: string;
  presentationId: string | null;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  initialVersionId: string | null;
  initialManifest: SlideManifest | null;
  initialSlideCount: number;
  initialSlideStates: InitialSlideState[];
  // Slide aspect ratio chosen on /create/brand. Used as the fallback for
  // the generating-state placeholder grid (when the manifest isn't ready
  // yet) so the cards have the correct orientation from the first paint.
  initialFormat: SlideFormat;
};

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

async function loadProject(projectId: string): Promise<InitialState | null> {
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
        select: { id: true, currentVersionId: true },
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
      },
    });
    initialSlideStates = states.map((s) => ({
      slideKey: s.slideKey,
      currentVersionNumber: s.currentVersionNumber,
      lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
      hasCachedComments: s.cachedComments != null,
    }));
  }

  return {
    projectTitle: project.title,
    presentationId: project.presentation?.id ?? null,
    initialProjectStatus: project.status,
    initialVersionStatus: version?.status ?? null,
    initialVersionId: version?.id ?? null,
    initialManifest: manifest,
    initialSlideCount,
    initialSlideStates,
    initialFormat,
  };
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await loadProject(projectId);
  if (!data) notFound();
  // Key DeckView on the version id + status so partial-regen completion
  // (currentVersionId flips from v_n → v_n+1) remounts the component and
  // reseeds from the new manifest. Without the version id in the key, a
  // completed→completed transition leaves the key unchanged and DeckView
  // keeps its prior `manifest` state (initialised lazily from old props).
  const deckKey = `${data.initialVersionId ?? "none"}:${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return <DeckView key={deckKey} projectId={projectId} {...data} />;
}
