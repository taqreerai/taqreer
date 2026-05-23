// /project/[projectId] — WORKING-SESSION route.
//
// Canonical URL for a completed deck. Owns the post-generation
// chrome: slide pill (regen / history / lock), comments, save,
// exports, lightbox. Bookmarks, share links, the "Copy link" 3-dots
// menu action, bell notifications, and dashboard tile clicks all
// point here.
//
// Lifecycle gate (inverse of /preview's): if the deck is NOT yet in
// the "completed" version state — still queued, generating, or
// mid-partial-regen — server-redirect to /preview. Together with
// /preview's redirect when completed, bookmarks of either URL
// always land the user on the right route for their deck's current
// state. New decks naturally enter at /preview during /create flow;
// completed bookmarks naturally land at /project.
//
// For now this route re-uses the existing `<DeckView />` component
// (which internally branches on status). A follow-up will extract
// the working-session half into a dedicated `<ProjectView />` and
// slim DeckView down to its generation-only path; that's pure code
// reorg and doesn't change route semantics.

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DeckView } from "@/components/preview/DeckView";
import { loadProject, isDeckReady } from "@/lib/project/load-project";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Same cookie name DashboardShell reads in app/(app)/layout.tsx —
// SSR-read here too so the SlideNavSidebar's `right:` value is
// correct on first paint and the panel doesn't slide on refresh.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Role-aware gate (Phase 15.A). Owner, accepted invitee (any role),
  // or public-view link viewer pass. Anyone else gets the same 404
  // the layout serves for non-existent projects — never leaks the
  // existence of a private deck. The resolved `role` is threaded
  // into DeckView so the editor can hide save / regen / lock / etc.
  // affordances for non-edit viewers (Phase 15.B).
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) notFound();
  const data = await loadProject(projectId);
  if (!data) notFound();

  // Inverse of /preview's gate — anything not completed gets
  // bounced to the generation-phase route. Covers: bookmarking
  // /project/<id> before save completes, an old-URL share that
  // outpaced generation, a partial-regen mid-stream.
  if (!isDeckReady(data)) {
    redirect(`/preview/${projectId}`);
  }

  const cookieStore = await cookies();
  const isCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";
  const initialMainSidebarWidth = isCollapsed ? 80 : 260;

  // Phase 16.B presence — same profile fetch as /preview's page. Null
  // for anonymous public-view (skips presence tracking entirely).
  const profile = access.user.prismaId
    ? await prisma.user.findUnique({
        where: { id: access.user.prismaId },
        select: { name: true, image: true },
      })
    : null;

  const deckKey = `${data.initialVersionId ?? "none"}:${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return (
    <DeckView
      key={deckKey}
      projectId={projectId}
      role={access.role}
      // Optional chain — anonymous public-view callers may have a
      // ProjectAccessContext where access.user is { id: null, prismaId: null }.
      currentUserId={access.user?.prismaId ?? null}
      currentUserName={profile?.name ?? null}
      currentUserImage={profile?.image ?? null}
      initialMainSidebarWidth={initialMainSidebarWidth}
      {...data}
    />
  );
}
