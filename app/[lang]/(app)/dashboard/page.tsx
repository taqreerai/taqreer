import { QuickActions } from "@/components/app/QuickActions";
import { HomeLibrary } from "@/components/app/HomeLibrary";
import type { ProjectsGridProject } from "@/components/app/ProjectsGrid";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Fresh SSR every navigation. Without this Next.js may serve a
// cached render from before the Inngest thumbnail-render job
// completed → placeholder tiles even after thumbnails are ready.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const existingUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  const dbUser = await prisma.user.upsert({
    where: { supabaseUserId: user.id },
    update: {},
    create: {
      supabaseUserId: user.id,
      email: user.email ?? `${user.id}@supabase.local`,
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      image: user.user_metadata?.avatar_url ?? null,
      plan: "free",
    },
  });

  if (!existingUser) {
    console.info("Created missing Prisma user for authenticated Supabase user", {
      supabaseUserId: user.id,
    });
  }

  const [projects, templates] = await Promise.all([
    prisma.project.findMany({
      // Hide cancelled projects from the recent grid. The user explicitly
      // stopped these mid-generation and any partial slides were discarded —
      // surfacing them as dead rows that can't be opened (DeckView redirects a
      // cancelled project into its recovery card) is worse than hiding them.
      // They still exist in the DB so /projects can show them later.
      where: { userId: dbUser.id, status: { not: "cancelled" } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      // Pinned columns only — keeps the SSR payload small. Feeds the HomeLibrary
      // "مشاريعي" grid (ProjectsGrid/ProjectThumbnail, same as /projects).
      select: {
        id: true,
        title: true,
        thumbnailUrls: true,
        createdAt: true,
        isFavorite: true,
        // `format` (tile aspect ratio) + `presentation.savedVersionId`
        // (thumbnails-pending derivation) feed the grid.
        format: true,
        presentation: { select: { savedVersionId: true } },
        // Drives the tile's pending-spinner state — `status` covers the FIRST-
        // generation window (queued / generating) so a deck still in the Inngest
        // pipeline shows the spinner instead of the static placeholder icon.
        status: true,
      },
    }),
    // Explicit select — only the fields MyTemplates actually renders. `brand`
    // is intentionally included (despite being a JSON blob) because the tile
    // renders the template's identity INLINE from brand attributes (palette +
    // heading font + chrome colours) rather than from a PNG — see MyTemplates.
    // The brand snapshot is small (~300 bytes per template).
    prisma.template.findMany({
      where: { ownerId: dbUser.id },
      orderBy: { createdAt: "desc" },
      // "القوالب" tab shows up to 10 (5 per row × 2 rows).
      take: 10,
      // `thumbnailUrls` feeds TemplateLightbox (opened in place from a tile).
      // `isPublic` drives the 3-dots menu's visibility toggle label.
      select: {
        id: true,
        brand: true,
        thumbnailUrls: true,
        isPublic: true,
        isPremium: true,
      },
    }),
  ]);

  // Narrow Template.brand (Prisma's JsonValue) to the shape MyTemplates
  // expects, with safe fallbacks per field. We deliberately do NOT
  // re-validate against BrandSnapshotSchema here — the Inngest pipeline
  // already validates on write, and the widget should keep rendering even if a
  // single row's JSON is partially malformed (a broken tile beats a broken page).
  const templateTiles = templates.map((t) => {
    const brand = (t.brand ?? {}) as Record<string, unknown>;
    const fontHeading =
      (brand.fontHeading as { name?: unknown; url?: unknown } | undefined) ?? {};
    return {
      id: t.id,
      // Dashboard only shows the user's OWN templates (query filters by
      // ownerId), so isMine is always true.
      isMine: true,
      isPublic: t.isPublic,
      isPremium: t.isPremium,
      thumbnailUrls: t.thumbnailUrls,
      // Drives the auto-refresh hook so a saved template's PNGs appear without
      // a manual reload once Inngest finishes rendering.
      thumbnailsPending: t.thumbnailUrls.length === 0,
      brand: {
        background:
          typeof brand.background === "string" ? brand.background : "#000000",
        text: typeof brand.text === "string" ? brand.text : "#FFFFFF",
        palette: Array.isArray(brand.palette)
          ? brand.palette.filter((v): v is string => typeof v === "string")
          : [],
        fontHeading: {
          name:
            typeof fontHeading.name === "string" ? fontHeading.name : "Cairo",
          url: typeof fontHeading.url === "string" ? fontHeading.url : undefined,
        },
        format: typeof brand.format === "string" ? brand.format : "16:9",
      },
    };
  });

  // §22: recent projects for the HomeLibrary "مشاريعي" tab — mapped to the same
  // ProjectsGridProject shape /projects uses (thumbnailsPending: queued/
  // generating, OR saved-but-no-thumbnails-yet).
  const homeProjects: ProjectsGridProject[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    createdAt: p.createdAt.toISOString(),
    thumbnailUrls: p.thumbnailUrls,
    format: p.format,
    isFavorite: p.isFavorite,
    thumbnailsPending:
      p.status === "queued" ||
      p.status === "generating" ||
      ((p.presentation?.savedVersionId ?? null) !== null &&
        p.thumbnailUrls.length === 0),
  }));

  return (
    <div className="page-container pb-16">
      {/* Centered launcher — the 4 flow cards. §22: the height leaves just
          enough so the HomeLibrary toggle header + the TOP of the thumbnails
          peek at the bottom of the first screen (Lovable-style), inviting a
          scroll to the projects / templates grid. */}
      <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
        <div className="w-full">
          <QuickActions />
        </div>
      </section>

      {/* §22: bottom "library" card — always-visible toggle (مشاريعي ⇄ القوالب)
          over the matching grid. */}
      <HomeLibrary projects={homeProjects} templates={templateTiles} />
    </div>
  );
}
