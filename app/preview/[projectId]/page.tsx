import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SlideManifestSchema, type SlideManifest } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";

export const dynamic = "force-dynamic";

async function loadManifest(projectId: string): Promise<SlideManifest | null> {
  const version = await prisma.presentationVersion.findFirst({
    where: {
      presentation: { projectId },
      status: "completed",
    },
    orderBy: { versionNumber: "desc" },
    select: { slideJson: true },
  });
  if (!version) return null;
  const result = SlideManifestSchema.safeParse(version.slideJson);
  if (!result.success) return null;
  return result.data;
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const manifest = await loadManifest(projectId);
  if (!manifest) notFound();

  const fontLinks = [
    manifest.fonts.heading.url,
    manifest.fonts.body.url,
  ].filter(
    (url, index, all) =>
      url.includes("fonts.googleapis.com") && all.indexOf(url) === index,
  );

  return (
    <main
      dir={manifest.direction}
      style={{
        minHeight: "100vh",
        background: "#03030D",
        padding: "32px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
      }}
    >
      {fontLinks.map((url) => (
        // eslint-disable-next-line @next/next/no-css-tags
        <link key={url} rel="stylesheet" href={url} />
      ))}

      <header style={{ color: "#FFFFFF", textAlign: "center", maxWidth: "1280px" }}>
        <p style={{ fontSize: "14px", color: "#9A94A8", letterSpacing: "0.1em" }}>
          PROJECT {projectId.slice(0, 8)} · {manifest.slides.length} SLIDES
        </p>
        <h1 style={{ fontSize: "24px", fontWeight: 600, marginTop: "8px" }}>
          Generated deck preview
        </h1>
      </header>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          width: "100%",
          alignItems: "center",
        }}
      >
        {manifest.slides.map((slide, index) => (
          <figure
            key={slide.slideId}
            style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}
          >
            <figcaption style={{ color: "#9A94A8", fontSize: "13px", letterSpacing: "0.08em" }}>
              SLIDE {index + 1} / {manifest.slides.length} · {slide.role ?? "content"}
            </figcaption>
            <div
              style={{
                border: "1px solid rgba(42,36,59,0.8)",
                borderRadius: "12px",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              }}
            >
              <SlideRenderer slide={slide} scale={0.5} />
            </div>
          </figure>
        ))}
      </div>
    </main>
  );
}
