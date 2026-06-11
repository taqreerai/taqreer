import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getStartOfMonthUTC } from "@/lib/utils";
import { normalizePlan } from "@/lib/plan";

const planLimits = { free: 10, plus: 30, pro: 60, max: 90 };

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

  const plan = normalizePlan(dbUser.plan);
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
