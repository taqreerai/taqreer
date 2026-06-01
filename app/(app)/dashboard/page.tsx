import { QuickActions } from "@/components/app/QuickActions";
import { RecentActivityWidget } from "@/components/app/RecentActivityWidget";
import {
  RecentGenerationWidget,
  type GenerationItem,
} from "@/components/app/RecentGenerationWidget";
import { MyTemplates } from "@/components/app/MyTemplates";
import { PlanUsage } from "@/components/app/PlanUsage";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getStartOfMonthUTC } from "@/lib/utils";
import { normalizePlan } from "@/lib/plan";

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

  const planLimits = { free: 10, plus: 60, pro: 90 };
  const plan = normalizePlan(dbUser.plan);
  const limit = planLimits[plan];
  const startOfMonth = getStartOfMonthUTC();

  const [projects, templates, subscription, usageCount] = await Promise.all([
    prisma.project.findMany({
      // Hide cancelled projects from the dashboard's recent grid.
      // The user explicitly stopped these mid-generation and any
      // partial slides were discarded — keeping them in "Recent"
      // surfaces dead rows that can't be opened (DeckView redirects
      // a cancelled project into its recovery card). They still
      // exist in the DB (so /projects can show them if we ever add
      // a "Cancelled" filter), they're just hidden from this widget.
      where: { userId: dbUser.id, status: { not: "cancelled" } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      // Pinned columns only — keeps the SSR payload small. Feeds the
      // "أحدث المشاريع" table rows: thumbnail, title, flow (`type`),
      // date, status, and `isFavorite` for the 3-dots star toggle.
      select: {
        id: true,
        title: true,
        // Generation flow (create | enhance | mimic | datasheet) — shown
        // under the project title in the "أحدث المشاريع" table.
        type: true,
        thumbnailUrls: true,
        createdAt: true,
        isFavorite: true,
        // Drives the tile's pending-spinner state — see
        // /projects/page.tsx for full rationale.
        // `status` covers the FIRST-generation window (queued /
        // generating) so a deck that's still in the Inngest pipeline
        // also shows the spinner — without this, the tile renders
        // the static placeholder icon while the user waits for the
        // initial deck-generate run to finish (user reported
        // 2026-05-24: came back to dashboard during a long extreme-
        // preset generation and saw a placeholder instead of "still
        // working" feedback).
        status: true,
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
      // "ابدأ من قالب" shows up to 10 (5 per row × 2 rows).
      take: 10,
      // `thumbnailUrls` is required because the dashboard tile click
      // now opens TemplateLightbox IN PLACE (no navigation), and the
      // lightbox needs the 4 showcase PNGs to render its stage.
      // `isPublic` drives the 3-dots menu's visibility toggle label
      // (`اجعله عاماً` vs `اجعله خاصاً`). All dashboard rows are the
      // user's own (filtered by ownerId above), so `isMine` is always
      // true at the call site — not selected from the DB.
      select: {
        id: true,
        brand: true,
        thumbnailUrls: true,
        isPublic: true,
        isPremium: true,
      },
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

  // "أحدث المشاريع" table rows — status + points-aware view of the
  // projects query (no extra DB round-trip). `points` is omitted for now
  // (no usage tracking yet); the row supplies a static placeholder until
  // the points/subscription model lands. `isFavorite` feeds the row's
  // 3-dots actions menu (star toggle).
  const recentGenerations: GenerationItem[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    thumbnailUrl: p.thumbnailUrls[0] ?? null,
    createdAt: p.createdAt.toISOString(),
    status: p.status,
    type: p.type,
    isFavorite: p.isFavorite,
  }));

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
      // Dashboard widget only shows the user's OWN templates (the
      // query filters by ownerId), so isMine is always true. The
      // 3-dots menu on each tile uses this to decide whether to
      // render the actions trigger.
      isMine: true,
      isPublic: t.isPublic,
      isPremium: t.isPremium,
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
      {/* RTL widget pair: the wide "أحدث المشاريع" table (2 cols) beside
          the narrower "النشاطات الأخيرة" feed (1 col). Points-usage graphs
          live inside the QuickActions cards (bottom sparkline). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentGenerationWidget generations={recentGenerations} />
        </div>
        <div className="lg:col-span-1">
          <RecentActivityWidget />
        </div>
      </div>
      {/* "ابدأ من قالب" — full-width templates card. */}
      <MyTemplates templates={templateTiles} />
      <PlanUsage
        plan={plan}
        usageCount={usageCount}
        limit={limit}
        renewalDate={subscription?.currentPeriodEnd ?? null}
      />
    </div>
  );
}
