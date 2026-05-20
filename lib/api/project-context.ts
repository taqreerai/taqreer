// Shared auth + project-lookup helper for every `/api/projects/[id]/*`
// route. Replaces the 4-line preamble (createClient → getUser →
// findFirst by supabaseUserId) that every route re-implemented.
//
// Two flavours:
//   `resolveProjectContext(projectId)`           — owner check only
//   `resolveProjectContextWithPresentation(...)`  — also pulls the
//     Presentation row + currentVersionId; 404s if either is missing
//
// Both return `{ error, status }` on failure so the caller can do
// `if ("error" in ctx) return NextResponse.json({ error: ctx.error },
// { status: ctx.status })` — same shape every consumer already
// expected from the inline implementations.

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type ProjectContextError = {
  error: "Unauthorized" | "Project not found";
  status: 401 | 404;
};

export type ProjectContext = {
  user: { id: string };
  project: {
    id: string;
    user: { id: string };
  };
};

export type ProjectContextWithPresentation = ProjectContext & {
  presentation: {
    id: string;
    currentVersionId: string;
  };
};

/**
 * Owner-gated project lookup. Returns the Supabase user + the
 * project row (only `id` + owner `user.id` selected). Use when the
 * route doesn't need any Presentation/version info.
 */
export async function resolveProjectContext(
  projectId: string,
): Promise<ProjectContext | ProjectContextError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!project) return { error: "Project not found", status: 404 };

  return { user: { id: user.id }, project };
}

/**
 * Same as above, but also requires a Presentation row WITH a
 * non-null `currentVersionId`. 404s on either missing condition.
 * Use when the route operates on the active version (regen, save,
 * slides/*, comments).
 */
export async function resolveProjectContextWithPresentation(
  projectId: string,
): Promise<ProjectContextWithPresentation | ProjectContextError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
    select: {
      id: true,
      user: { select: { id: true } },
      presentation: {
        select: { id: true, currentVersionId: true },
      },
    },
  });
  if (
    !project ||
    !project.presentation ||
    !project.presentation.currentVersionId
  ) {
    return { error: "Project not found", status: 404 };
  }

  return {
    user: { id: user.id },
    project: { id: project.id, user: project.user },
    presentation: {
      id: project.presentation.id,
      currentVersionId: project.presentation.currentVersionId,
    },
  };
}
