import { QuickActions } from "@/components/app/QuickActions";
import { HomeLibrary } from "@/components/app/HomeLibrary";
import type { ProjectsGridProject } from "@/components/app/ProjectsGrid";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/supabase/user";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { maybeGrantSignupCredits } from "@/lib/credits/signup";
import { dispatchWelcomeEmail } from "@/lib/email/send-welcome";
import { clientIpFromHeaders } from "@/lib/api/rate-limit";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";

// Fresh SSR every navigation. Without this Next.js may serve a
// cached render from before the Inngest thumbnail-render job
// completed → placeholder tiles even after thumbnails are ready.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  // Request-cached: reuses the (app) layout's Supabase auth round trip.
  const user = await getAuthUser();

  if (!user) {
    redirect(`/${lang}/login?next=/${lang}/dashboard`);
  }

  // Single round trip: the upsert IS the existence check (empty update
  // returns the existing row; a brand-new user comes back with
  // creditAccount null, which is exactly what gates the signup grant below).
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
    select: {
      id: true,
      email: true,
      name: true,
      creditAccount: { select: { signupGrantedAt: true } },
    },
  });

  // One-time signup grant, gated on signupGrantedAt (idempotent under a row
  // lock). Landing on the dashboard is a 4th user-creation path; without this a
  // user who never hits user-sync/projects - e.g. one whose confirm link was
  // mis-redirected so the client grant call never ran on this origin - keeps 0
  // credits. Abuse checks live in maybeGrantSignupCredits; a failure or block
  // just leaves the balance untouched (never breaks the dashboard render).
  if (!dbUser.creditAccount?.signupGrantedAt) {
    const hdrs = await headers();
    const grant = await maybeGrantSignupCredits({
      userId: dbUser.id,
      email: dbUser.email,
      ip: clientIpFromHeaders(hdrs),
    }).catch(() => null);
    // Welcome email, once, when THIS path lands the grant - mirrors user-sync
    // and projects. A user who first materializes on the dashboard (e.g. a
    // confirm link that landed elsewhere so the client grant never ran) would
    // otherwise never get it. Fire-and-forget; never blocks the render.
    if (grant && grant.granted > 0) {
      void dispatchWelcomeEmail({
        toEmail: dbUser.email,
        metadataLang: user.user_metadata?.lang,
        cookieHeader: hdrs.get("cookie"),
        fallbackLocale: lang,
        appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
        freeCredits: grant.granted,
      });
    }
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
      // §22: the "القوالب" tab now surfaces PUBLIC templates to EVERY user
      // (discovery), not just their own. OR(own, public) -> public first by
      // publishedAt (featured + community), then the user's own private rows.
      where: { OR: [{ ownerId: dbUser.id }, { isPublic: true }] },
      orderBy: [
        { publishedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      // up to 10 (5 per row × 2 rows).
      take: 10,
      // `thumbnailUrls` feeds TemplateLightbox; `ownerId` -> isMine (the 3-dots
      // edit menu + the visibility toggle render only for the user's own tiles).
      select: {
        id: true,
        ownerId: true,
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
      // The tab now mixes the user's own + public community templates; the
      // 3-dots edit menu + visibility toggle render only for the user's own.
      isMine: t.ownerId === dbUser.id,
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

  // Greeting above the launcher. First name only; falls back to a name-less
  // variant when we don't have one yet (fresh OAuth user with no metadata name).
  const dict = await getDictionary(isLocale(lang) ? lang : "ar");
  const firstName = (dbUser.name ?? "").trim().split(/\s+/)[0] ?? "";
  const greeting = firstName
    ? dict.quickActions.greeting.replace("{name}", firstName)
    : dict.quickActions.greetingAnon;

  return (
    <div className="page-container pb-16">
      {/* Centered launcher — a welcome line + the 4 flow cards. §22: the height
          leaves just enough so the HomeLibrary toggle header + the TOP of the
          thumbnails peek at the bottom of the first screen (Lovable-style),
          inviting a scroll to the projects / templates grid. */}
      <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
        <div className="w-full">
          <h1 className="mx-auto mb-8 max-w-3xl text-balance text-center text-2xl font-semibold text-foreground sm:text-3xl">
            {greeting}
          </h1>
          <QuickActions />
        </div>
      </section>

      {/* §22: bottom "library" card — always-visible toggle (مشاريعي ⇄ القوالب)
          over the matching grid. */}
      <HomeLibrary projects={homeProjects} templates={templateTiles} />
    </div>
  );
}
