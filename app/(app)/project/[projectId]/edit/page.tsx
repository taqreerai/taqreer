// /project/[projectId]/edit — the manual in-canvas EDITOR surface (Editor I1-B).
//
// A dedicated route, separate from the working-session <DeckView>, so the editor is
// its own clean surface and we never destabilise the live view. Edit-capable roles
// only (owner / edit); anyone else gets the same 404 the rest of /project serves so
// we never leak a private deck's existence.
import { notFound, redirect } from "next/navigation";
import { loadProject, isDeckReady } from "@/lib/project/load-project";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { ProjectEditor } from "@/components/preview/editor/ProjectEditor";

export const dynamic = "force-dynamic";

export default async function ProjectEditPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) notFound();
  // Editing is owner/edit only — comment + view roles can't reach this surface.
  if (access.role !== "owner" && access.role !== "edit") notFound();

  const data = await loadProject(projectId);
  if (!data?.initialManifest) notFound();
  // Mirror /project's gate: a not-yet-completed deck belongs in the generation route.
  if (!isDeckReady(data)) redirect(`/preview/${projectId}`);

  return (
    <ProjectEditor
      projectId={projectId}
      manifest={data.initialManifest}
      role={access.role}
    />
  );
}
