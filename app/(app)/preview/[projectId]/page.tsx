import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SlideManifestSchema, type SlideManifest } from "@/lib/schema/slide";
import { DeckView } from "@/components/preview/DeckView";

export const dynamic = "force-dynamic";

type InitialState = {
  projectTitle: string;
  presentationId: string | null;
  initialProjectStatus: string;
  initialVersionStatus: string | null;
  initialManifest: SlideManifest | null;
  initialSlideCount: number;
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
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      status: true,
      aiPrompt: true,
      presentation: {
        select: {
          id: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { status: true, slideJson: true },
          },
        },
      },
    },
  });
  if (!project) return null;

  const version = project.presentation?.versions[0] ?? null;

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

  return {
    projectTitle: project.title,
    presentationId: project.presentation?.id ?? null,
    initialProjectStatus: project.status,
    initialVersionStatus: version?.status ?? null,
    initialManifest: manifest,
    initialSlideCount,
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
  // Key DeckView on the server-observed status so a generating→completed (or
  // completed→generating after regenerate) transition remounts the component
  // and reseeds state from the new props — no in-effect prop-to-state sync.
  const deckKey = `${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return <DeckView key={deckKey} projectId={projectId} {...data} />;
}
