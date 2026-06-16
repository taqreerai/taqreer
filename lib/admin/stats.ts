// Admin Overview aggregates (server-only). Real numbers from Prisma + Stripe.
// The geo globe + device/browser breakdown stay mock in the UI - they need
// analytics infra (CF-IPCountry capture / PostHog) we don't have yet.
//
// Metric definitions (kept simple + honest; revisit as volume grows):
//   - Total users          : non-admin User rows (matches the Users table).
//   - Active subscriptions  : Subscription status="active" on a paid plan.
//   - Stripe balance        : real current Stripe account balance (available +
//                             pending, USD) straight from the Stripe API.
//   - Decks generated (30d) : Presentations created in the last 30 days.
//   - Credits spent (30d)   : sum of settled CreditHold charges in the last 30d.
// Sparklines + deltas are omitted for now (they need a daily-snapshot series;
// the cards render value-only until that exists).

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/billing/stripe";
import type { AdminStat, ActivityItem, Plan } from "@/lib/admin/mock";

const PAID_PLANS = ["plus", "pro", "max"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const fmt = (n: number) => n.toLocaleString("en-US");

function timeAgo(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Real current Stripe account balance (available + pending) in USD. Resilient:
// a Stripe hiccup must not blank the whole Overview, so it returns null on
// failure and the card shows "n/a".
async function getStripeBalanceUsd(): Promise<number | null> {
  try {
    const bal = await stripe.balance.retrieve();
    const cents = [...bal.available, ...bal.pending]
      .filter((b) => b.currency === "usd")
      .reduce((sum, b) => sum + b.amount, 0);
    return cents / 100;
  } catch (err) {
    console.error("[admin/stats] stripe balance fetch failed", err);
    return null;
  }
}

export async function getOverviewStats(): Promise<{
  stats: AdminStat[];
  planSplit: Record<Plan, number>;
  activity: ActivityItem[];
}> {
  const since30 = new Date(Date.now() - 30 * DAY_MS);

  const [totalUsers, planGroups, activeSubsCount, decks30, spent, balanceUsd] =
    await Promise.all([
      prisma.user.count({ where: { role: { not: "admin" } } }),
      prisma.user.groupBy({
        by: ["plan"],
        where: { role: { not: "admin" } },
        _count: { _all: true },
      }),
      prisma.subscription.count({
        where: { status: "active", plan: { in: [...PAID_PLANS] } },
      }),
      prisma.presentation.count({ where: { createdAt: { gte: since30 } } }),
      prisma.creditHold.aggregate({
        _sum: { amountCharged: true },
        where: { status: "settled", createdAt: { gte: since30 } },
      }),
      getStripeBalanceUsd(),
    ]);

  const planSplit: Record<Plan, number> = { free: 0, plus: 0, pro: 0, max: 0 };
  for (const g of planGroups) {
    if (g.plan in planSplit) planSplit[g.plan as Plan] = g._count._all;
  }

  const creditsSpent30 = spent._sum.amountCharged ?? 0;

  const stats: AdminStat[] = [
    { key: "users", label: "Total users", value: fmt(totalUsers), spark: [] },
    { key: "subs", label: "Active subscriptions", value: fmt(activeSubsCount), spark: [] },
    {
      key: "balance",
      label: "Stripe balance",
      value:
        balanceUsd === null
          ? "n/a"
          : `$${balanceUsd.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
      spark: [],
    },
    { key: "decks", label: "Decks generated (30d)", value: fmt(decks30), spark: [] },
    { key: "credits", label: "Credits spent (30d)", value: fmt(creditsSpent30), spark: [] },
  ];

  const activity = await getRecentActivity();
  return { stats, planSplit, activity };
}

// Recent activity feed - newest signups / generations / purchases, merged.
async function getRecentActivity(): Promise<ActivityItem[]> {
  const [signups, generations, purchases] = await Promise.all([
    prisma.user.findMany({
      where: { role: { not: "admin" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, email: true, createdAt: true },
    }),
    prisma.presentation.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, createdAt: true },
    }),
    prisma.topupGrant.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, amountGranted: true, createdAt: true, user: { select: { email: true } } },
    }),
  ]);

  const events: { date: Date; item: ActivityItem }[] = [
    ...signups.map((u) => ({
      date: u.createdAt,
      item: { id: `s-${u.id}`, kind: "signup" as const, text: `${u.email} signed up`, at: timeAgo(u.createdAt) },
    })),
    ...generations.map((p) => ({
      date: p.createdAt,
      item: { id: `g-${p.id}`, kind: "generation" as const, text: "A new deck was generated", at: timeAgo(p.createdAt) },
    })),
    ...purchases.map((t) => ({
      date: t.createdAt,
      item: { id: `p-${t.id}`, kind: "purchase" as const, text: `${t.user.email} bought ${fmt(t.amountGranted)} credits`, at: timeAgo(t.createdAt) },
    })),
  ];

  return events
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6)
    .map((e) => e.item);
}
