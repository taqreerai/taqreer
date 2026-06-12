// /projects — every project the user owns, with browse + filter.
//
// Sister page to /favorites (same grid component, no isFavorite WHERE
// filter). Server-fetches the full uncapped list newest-first and
// hands it to the client wrapper, which owns the filter state + the
// search input + the swatch picker.
//
// Filters live client-side (in-memory) for v1 — instant feedback,
// no URL roundtrips. URL state (bookmarkable filtered views) can
// be wired later; the grid component is stable so adding ?q=… +
// useSearchParams is additive.
//
// Select clause mirrors RecentProjects + adds the filter columns
// (`language`, `dominantColor`) the page needs but the dashboard
// widget does not.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ProjectsPageClient } from "./ProjectsPageClient";

// Force a fresh server fetch on every navigation. Without this,
// Next.js may serve a cached render that pre-dates the Inngest
// thumbnail-render job's completion — users would see placeholder
// tiles even though `thumbnailUrls` is now populated server-side.
// The client also schedules a `router.refresh()` if any tile has
// empty thumbnails, so a save → navigate flow recovers within a
// few seconds without a manual page reload.
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ lang: "ar" | "en" }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${lang}/login?next=/${lang}/projects`);
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  // Defensive: Prisma row missing → bounce to /dashboard so first-
  // login upsert materialises it. Avoids confusing empty state.
  if (!dbUser) {
    redirect(`/${lang}/dashboard`);
  }

  // Owned projects PLUS decks shared WITH this user (accepted edit /
  // comment invites - user direction 2026-06-12: an accepted invite
  // surfaces the deck in the invitee's projects list; it is the SAME
  // deck, not a copy).
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { userId: dbUser.id },
        {
          shares: {
            some: {
              userId: dbUser.id,
              acceptedAt: { not: null },
              accessLevel: { in: ["edit", "comment"] },
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      format: true,
      language: true,
      thumbnailUrls: true,
      createdAt: true,
      isFavorite: true,
      // Swatch picker source. `dominantColor` (single hex) is kept
      // around for legacy use; `colorTags` (multi-hex) is the
      // canonical filter source post 2026-05-21 (handles
      // greyscale-only decks + multi-accent palettes correctly).
      dominantColor: true,
      colorTags: true,
      // `savedVersionId` drives the tile's pending-spinner state.
      // Non-null AND empty thumbnailUrls means "save fired, Inngest
      // job in flight" → spinner. Null + empty means legacy
      // (never saved) → static placeholder. The presentation
      // relation is optional so the null-coalesce handles legacy
      // projects without a presentation row at all.
      // `status` ALSO drives the spinner — "queued" / "generating"
      // means deck-generate is still in flight, so the tile shows
      // the same loader instead of a placeholder. See dashboard
      // page for the full rationale.
      status: true,
      presentation: { select: { savedVersionId: true } },
      // Only this user's share rows (empty for owned projects) - the
      // tile renders the shared badge from it.
      shares: {
        where: { userId: dbUser.id, acceptedAt: { not: null } },
        select: { accessLevel: true },
        take: 1,
      },
      userId: true,
    },
  });

  // Compute pending state once on the server so the client doesn't
  // need to read the presentation relation. Sheds the relation from
  // the row + flattens to a single boolean.
  //
  // Pending fires in either case:
  //   1. status is "queued" / "generating" — initial deck-generate
  //      run is still in flight.
  //   2. savedVersionId is non-null AND thumbnailUrls is empty —
  //      deck saved but thumbnail-render Inngest job hasn't landed.
  const projectsWithPending = projects.map(
    ({ presentation, status, shares, userId, ...rest }) => ({
      ...rest,
      // null = own project; "edit"/"comment" = shared with me.
      sharedRole: userId === dbUser.id ? null : (shares[0]?.accessLevel ?? null),
      thumbnailsPending:
        status === "queued" ||
        status === "generating" ||
        ((presentation?.savedVersionId ?? null) !== null &&
          rest.thumbnailUrls.length === 0),
    }),
  );

  return (
    <div className="page-container">
      <header className="mb-8">
        <h1 className="tq-h1">{dict.pages.projects.title}</h1>
        <p className="tq-subhead">{dict.pages.projects.subtitle}</p>
      </header>
      <ProjectsPageClient projects={projectsWithPending} />
    </div>
  );
}
