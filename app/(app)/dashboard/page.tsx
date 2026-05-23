import { QuickActions } from "@/components/app/QuickActions";
import { RecentProjects } from "@/components/app/RecentProjects";
import { MyTemplates } from "@/components/app/MyTemplates";
import { PlanUsage } from "@/components/app/PlanUsage";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getStartOfMonthUTC } from "@/lib/utils";

// Fresh SSR every navigation. Without this Next.js may serve a
// cached render from before the Inngest thumbnail-render job
// completed → placeholder tiles even after thumbnails are ready.
// The RecentProjects client component also schedules a
// `router.refresh()` if any tile has empty thumbnails.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/dashboard");
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

  const planLimits = { free: 10, plus: 60, pro: 90 };
  const plan = isKnownPlan(dbUser.plan) ? dbUser.plan : "free";
  const limit = planLimits[plan];
  const startOfMonth = getStartOfMonthUTC();

  const [projects, templates, subscription, usageCount] = await Promise.all([
    prisma.project.findMany({
      where: { userId: dbUser.id },
      orderBy: { updatedAt: "desc" },
      take: 6,
      // Pinned columns only — keeps the SSR payload small and makes
      // the RecentProjects `Project` type the canonical contract.
      // `thumbnailUrls` + `format` are required by the new tile
      // (hover scrub + aspect-ratio crop). `isFavorite` feeds the
      // 3-dots menu's star icon + label (step 9f).
      select: {
        id: true,
        title: true,
        format: true,
        thumbnailUrls: true,
        createdAt: true,
        isFavorite: true,
        // Drives the tile's pending-spinner state — see
        // /projects/page.tsx for full rationale.
        presentation: { select: { savedVersionId: true } },
      },
    }),
    // Explicit select — only the fields MyTemplates actually renders.
    // `brand` is intentionally included (despite being a JSON blob)
    // because the dashboard tile renders the template's identity
    // INLINE from brand attributes (palette + heading font + chrome
    // colours) rather than from a PNG screenshot — see MyTemplates.tsx
    // for the rationale. The brand snapshot is small (~300 bytes per
    // template) so the 6-row payload is well under a KB.
    prisma.template.findMany({
      where: { ownerId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      // `thumbnailUrls` is required because the dashboard tile click
      // now opens TemplateLightbox IN PLACE (no navigation), and the
      // lightbox needs the 4 showcase PNGs to render its stage.
      // `isPublic` drives the 3-dots menu's visibility toggle label
      // (`اجعله عاماً` vs `اجعله خاصاً`). All dashboard rows are the
      // user's own (filtered by ownerId above), so `isMine` is always
      // true at the call site — not selected from the DB.
      select: { id: true, title: true, brand: true, thumbnailUrls: true, isPublic: true },
    }),
    prisma.subscription.findFirst({
      where: { userId: dbUser.id },
    }),
    prisma.usageEvent.count({
      where: {
        userId: dbUser.id,
        eventType: "presentation_generated",
        createdAt: { gte: startOfMonth },
      },
    }),
  ]);

  // Flatten the presentation relation into a single boolean. See
  // /projects/page.tsx for the pending/legacy rationale.
  const projectsWithPending = projects.map(
    ({ presentation, ...rest }) => ({
      ...rest,
      thumbnailsPending:
        (presentation?.savedVersionId ?? null) !== null &&
        rest.thumbnailUrls.length === 0,
    }),
  );

  // Narrow Template.brand (Prisma's JsonValue) to the shape MyTemplates
  // expects, with safe fallbacks per field. We deliberately do NOT
  // re-validate against BrandSnapshotSchema here — the Inngest pipeline
  // already validates on write, and the dashboard widget should keep
  // rendering even if a single row's JSON is partially malformed
  // (a broken tile is preferable to a broken dashboard).
  const templateTiles = templates.map((t) => {
    const brand = (t.brand ?? {}) as Record<string, unknown>;
    const fontHeading =
      (brand.fontHeading as { name?: unknown; url?: unknown } | undefined) ?? {};
    return {
      id: t.id,
      title: t.title,
      // Dashboard widget only shows the user's OWN templates (the
      // query filters by ownerId), so isMine is always true. The
      // 3-dots menu on each tile uses this to decide whether to
      // render the actions trigger.
      isMine: true,
      isPublic: t.isPublic,
      thumbnailUrls: t.thumbnailUrls,
      // Drives the dashboard widget's auto-refresh hook so a saved
      // template's PNGs appear without a manual reload once Inngest
      // finishes rendering.
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

  return (
    // Page-level vertical rhythm — `space-y-16` (64px) separates the
    // dashboard's three major sections (QuickActions / widget pair /
    // PlanUsage) at the spacing scale Linear / Vercel / Stripe
    // dashboards converge on for "distinct content blocks". `pt-8`
    // + `pb-12` keep content from kissing the header and viewport
    // edge respectively. All values are Tailwind v4 utilities, so
    // they compose from `--spacing` and scale automatically if the
    // design token ever moves.
    <div className="page-container space-y-16 pt-8 pb-12">
      <QuickActions />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-20">
        <RecentProjects projects={projectsWithPending} />
        <MyTemplates templates={templateTiles} />
      </div>
      <PlanUsage
        plan={plan}
        usageCount={usageCount}
        limit={limit}
        renewalDate={subscription?.currentPeriodEnd ?? null}
      />
    </div>
  );
}

function isKnownPlan(plan: string): plan is "free" | "plus" | "pro" {
  return plan === "free" || plan === "plus" || plan === "pro";
}
