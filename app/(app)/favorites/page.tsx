// /favorites — the user's starred projects (step 12).
//
// Renames the old `/features` placeholder slot from the sidebar.
// `Project.isFavorite` is toggled from the 3-dots menu on every
// project tile (ProjectActionsMenu, step 9f); this page is the
// "show me everything I starred" destination.
//
// Server component: auth check → dbUser resolution → uncapped
// `where: { isFavorite: true }` query → handoff to the client
// FavoritesGrid for tile state (lightbox, optimistic delete,
// inline rename). Mirrors the dashboard auth pattern.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { FavoritesGrid } from "./FavoritesGrid";

// Same caching dance as /projects + /dashboard — fresh SSR plus
// client-side refresh-when-thumbnails-missing in the grid component.
export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/favorites");
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  // If the Supabase session exists but the Prisma row doesn't, the
  // user hasn't completed first-login bootstrap (dashboard upserts
  // it). Bounce them to /dashboard to materialise the row before
  // any project queries run — avoids a confusing empty state.
  if (!dbUser) {
    redirect("/dashboard");
  }

  // Same select clause shape as the dashboard RecentProjects query,
  // sans the `take: 6` cap. Order newest-first so freshly-starred
  // decks bubble to the top; users can re-star to re-order if we
  // ever need a manual-sort affordance (out of scope for step 12).
  const projects = await prisma.project.findMany({
    where: { userId: dbUser.id, isFavorite: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      format: true,
      thumbnailUrls: true,
      createdAt: true,
      isFavorite: true,
      // Drives the pending-spinner state on each tile — see
      // /projects/page.tsx for the rationale.
      presentation: { select: { savedVersionId: true } },
    },
  });

  const projectsWithPending = projects.map(
    ({ presentation, ...rest }) => ({
      ...rest,
      thumbnailsPending:
        (presentation?.savedVersionId ?? null) !== null &&
        rest.thumbnailUrls.length === 0,
    }),
  );

  return (
    <div className="page-container">
      <header className="mb-8">
        <h1 className="tq-h1">المفضلة</h1>
        <p className="tq-subhead">
          مشاريعك التي وضعت عليها نجمة من قائمة الخيارات.
        </p>
      </header>
      <FavoritesGrid projects={projectsWithPending} />
    </div>
  );
}
