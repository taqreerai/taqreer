// /library — the user's AI-generated images.
//
// Sister page to /projects: same edge-to-edge shell + browse/filter
// pattern, but the rows are the GeneratedImage records that fill a
// deck's reserved image boxes (context/images.md). Lets the user
// re-download any image their decks generated.
//
// Scope (user direction 2026-06-01): the CURRENT deck only — images
// pinned to each project's SAVED version (Presentation.savedVersionId).
// Images from earlier regenerated/superseded versions are excluded so
// the library mirrors what's actually in the user's decks today.
//
// Two queries instead of a deep relation compare in `where` (Prisma
// can't compare a column to a related column): the user's saved
// versions → their ids, then the ready GeneratedImages pinned to those
// versions, joined back to the project title in memory.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { LibraryPageClient, type LibraryImage } from "./LibraryPageClient";

// Fresh fetch on every navigation — generated images land
// asynchronously (deck-images-generate), so a cached render could miss
// images that became `ready` after the last visit.
export const dynamic = "force-dynamic";

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${lang}/login?next=/${lang}/library`);
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    redirect(`/${lang}/dashboard`);
  }

  // The user's projects that have a saved version, mapped
  // savedVersionId → project, so each image row joins back to its
  // project title without a per-row relation read.
  const projects = await prisma.project.findMany({
    where: {
      userId: dbUser.id,
      presentation: { savedVersionId: { not: null } },
    },
    select: {
      id: true,
      title: true,
      presentation: { select: { savedVersionId: true } },
    },
  });
  const versionToProject = new Map<string, { id: string; title: string }>();
  for (const p of projects) {
    const vid = p.presentation?.savedVersionId;
    if (vid) versionToProject.set(vid, { id: p.id, title: p.title });
  }
  const savedVersionIds = [...versionToProject.keys()];

  let images: LibraryImage[] = [];
  if (savedVersionIds.length > 0) {
    const rows = await prisma.generatedImage.findMany({
      where: {
        presentationVersionId: { in: savedVersionIds },
        status: "ready",
        storageUrl: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        storageUrl: true,
        role: true,
        createdAt: true,
        presentationVersionId: true,
      },
    });
    images = rows.flatMap((r) => {
      const proj = versionToProject.get(r.presentationVersionId);
      if (!proj || !r.storageUrl) return [];
      return [
        {
          id: r.id,
          url: r.storageUrl,
          role: r.role,
          projectId: proj.id,
          projectTitle: proj.title,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  }

  return <LibraryPageClient images={images} />;
}
