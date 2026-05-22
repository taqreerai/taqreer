// /preview/[projectId] — GENERATION-PHASE route.
//
// Post-route-split (2026-05-21) this route owns the streaming /
// "Claude is working" UI only. Once the deck finishes generating,
// users live at /project/[projectId] — the canonical share /
// bookmark URL for a completed deck.
//
// Lifecycle gate: if the project is already in the "completed"
// version state when this page loads, server-redirect to /project.
// Together with the inverse redirect on /project (in-flight →
// /preview), bookmarks of either URL always land the user on the
// correct side of the split for their deck's current state. The
// client-side counterpart lives in DeckView, which calls
// `router.replace("/project/<id>")` the moment its stream-complete
// hook fires.

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DeckView } from "@/components/preview/DeckView";
import { loadProject, isDeckReady } from "@/lib/project/load-project";

export const dynamic = "force-dynamic";

// Match DashboardShell's `sidebarCookieKey`. SSR-read here so the
// SlideNavSidebar's `right:` value is correct on first paint — no
// flash of 260 → 80 on refresh when the user has the main sidebar
// collapsed.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await loadProject(projectId);
  if (!data) notFound();

  // Bidirectional redirect — completed decks live at /project. SSR
  // catches the case where a user navigates to /preview/<id> for a
  // deck that finished generating in another tab / since they last
  // visited / via a stale bell notification.
  if (isDeckReady(data)) {
    redirect(`/project/${projectId}`);
  }

  const cookieStore = await cookies();
  const isCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";
  const initialMainSidebarWidth = isCollapsed ? 80 : 260;

  // Key DeckView on the version id + status so partial-regen completion
  // (currentVersionId flips from v_n → v_n+1) remounts the component and
  // reseeds from the new manifest. Without the version id in the key, a
  // completed→completed transition leaves the key unchanged and DeckView
  // keeps its prior `manifest` state (initialised lazily from old props).
  const deckKey = `${data.initialVersionId ?? "none"}:${data.initialVersionStatus ?? "pending"}:${data.initialManifest ? "1" : "0"}`;
  return (
    <DeckView
      key={deckKey}
      projectId={projectId}
      initialMainSidebarWidth={initialMainSidebarWidth}
      {...data}
    />
  );
}
