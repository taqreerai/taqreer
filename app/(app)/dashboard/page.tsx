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
      },
    }),
    prisma.template.findMany({
      where: { ownerId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 6,
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

  return (
    <div className="page-container space-y-8">
      <QuickActions />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentProjects projects={projects} />
        <MyTemplates templates={templates} />
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
