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
import { ProjectsPageClient } from "./ProjectsPageClient";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/projects");
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  // Defensive: Prisma row missing → bounce to /dashboard so first-
  // login upsert materialises it. Avoids confusing empty state.
  if (!dbUser) {
    redirect("/dashboard");
  }

  const projects = await prisma.project.findMany({
    where: { userId: dbUser.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      format: true,
      language: true,
      thumbnailUrls: true,
      createdAt: true,
      isFavorite: true,
      dominantColor: true,
    },
  });

  return (
    <div className="page-container">
      <header className="mb-8">
        <h1 className="tq-h1">مشاريعي</h1>
        <p className="tq-subhead">
          كل مشاريعك في مكان واحد. ابحث، صفّ، أو اختر لوناً من شريط الألوان أدناه.
        </p>
      </header>
      <ProjectsPageClient projects={projects} />
    </div>
  );
}
