import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getStartOfMonthUTC } from "@/lib/utils";

const planLimits = { free: 10, plus: 60, pro: 90 };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
  });

  if (!dbUser) {
    return NextResponse.json({
      plan: "free",
      usageCount: 0,
      limit: planLimits.free,
      renewalDate: null,
    });
  }

  const plan = isKnownPlan(dbUser.plan) ? dbUser.plan : "free";
  const startOfMonth = getStartOfMonthUTC();
  const [subscription, usageCount] = await Promise.all([
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

  return NextResponse.json({
    plan,
    usageCount,
    limit: planLimits[plan],
    renewalDate: subscription?.currentPeriodEnd ?? null,
  });
}

function isKnownPlan(plan: string): plan is keyof typeof planLimits {
  return plan === "free" || plan === "plus" || plan === "pro";
}
