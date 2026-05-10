import { QuickActions } from "@/components/app/QuickActions";
import { RecentProjects } from "@/components/app/RecentProjects";
import { MyTemplates } from "@/components/app/MyTemplates";
import { PlanUsage } from "@/components/app/PlanUsage";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getStartOfMonthUTC } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/dashboard");
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
  });

  const planLimits = { free: 10, plus: 60, pro: 90 };
  const plan = dbUser && isKnownPlan(dbUser.plan) ? dbUser.plan : "free";
  const limit = planLimits[plan];
  const startOfMonth = getStartOfMonthUTC();

  const [projects, templates, subscription, usageCount] = dbUser
    ? await Promise.all([
        prisma.project.findMany({
          where: { userId: dbUser.id },
          orderBy: { updatedAt: "desc" },
          take: 6,
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
      ])
    : [[], [], null, 0];

  return (
    <div className="page-container space-y-16">
      <QuickActions />
      <RecentProjects projects={projects} />
      <MyTemplates templates={templates} />
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
