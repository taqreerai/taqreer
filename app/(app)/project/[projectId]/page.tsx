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

import { notFound, redirect } from "next/navigation";
import { DeckView } from "@/components/preview/DeckView";
import { loadProject, isDeckReady } from "@/lib/project/load-project";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await loadProject(projectId);
  if (!data) notFound();

  // Inverse of /preview's gate — anything not completed gets
  // bounced to the generation-phase route. Covers: bookmarking
  // /project/<id> before save completes, an old-URL share that
  // outpaced generation, a partial-regen mid-stream.
  if (!isDeckReady(data)) {
    redirect(`/preview/${projectId}`);
  }

  const deckKey = `${data.initialVersionId ?? "none"}:${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return <DeckView key={deckKey} projectId={projectId} {...data} />;
}
