// /lab/editor — DEV-ONLY prototype for the in-canvas slide editor (Phase 0).
// NOT linked anywhere; 404s in production. Loads a REAL deck read-only via
// ?project=<id> and runs the feasibility tests from context/phase-0-checklist.md
// against its slides. Edits live only in memory — nothing persists here.
import { notFound } from "next/navigation";
import { loadProject } from "@/lib/project/load-project";
import { LabEditor } from "./LabEditor";

export const dynamic = "force-dynamic";

export default async function LabEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  // Hard gate: this tool never ships.
  if (process.env.NODE_ENV === "production") notFound();

  const { project } = await searchParams;

  if (!project) {
    return (
      <Shell>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>/lab/editor</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>
          Add <code>?project=&lt;projectId&gt;</code> to load a real deck.
        </p>
      </Shell>
    );
  }

  const data = await loadProject(project);
  if (!data?.initialManifest) {
    return (
      <Shell>
        <p style={{ opacity: 0.7 }}>
          No completed manifest found for project <code>{project}</code>.
        </p>
      </Shell>
    );
  }

  return <LabEditor manifest={data.initialManifest} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0D0B1F",
        color: "#fff",
        fontFamily: "Cairo, system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}
