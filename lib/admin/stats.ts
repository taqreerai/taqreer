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
import { getLiveStripeOrNull } from "@/lib/billing/stripe";
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

// Real current LIVE Stripe account balance (available + pending) in USD.
// Live-only: with no live key in this environment (e.g. local dev on test keys)
// it returns null and the card shows "n/a" rather than a test-mode figure. Also
// resilient - a Stripe hiccup returns null instead of blanking the Overview.
async function getStripeBalanceUsd(): Promise<number | null> {
  const client = getLiveStripeOrNull();
  if (!client) return null;
  try {
    const bal = await client.balance.retrieve();
    const cents = [...bal.available, ...bal.pending]
      .filter((b) => b.currency === "usd")
      .reduce((sum, b) => sum + b.amount, 0);
    return cents / 100;
  } catch (err) {
    console.error("[admin/stats] stripe live balance fetch failed", err);
    return null;
  }
}

export async function getOverviewStats(): Promise<{
  stats: AdminStat[];
  planSplit: Record<Plan, number>;
  activity: ActivityItem[];
}> {
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  // Kick off the activity feed alongside the KPI queries (independent roundtrip).
  const activityPromise = getRecentActivity();

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

  const activity = await activityPromise;
  return { stats, planSplit, activity };
}

// Format a generation duration (ms) compactly: "42s", "3m 20s", "1h 5m".
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const FLOW_LABEL: Record<string, string> = {
  create: "Create",
  enhance: "Enhance",
  mimic: "Mimic",
  datasheet: "Datasheet",
};

// Recent activity feed - newest signups / generations / partial regens /
// purchases, merged newest-first. Generation + regen rows are enriched with the
// generator's email, the charged cost, and precise duration.
async function getRecentActivity(): Promise<ActivityItem[]> {
  const [signups, jobs, purchases] = await Promise.all([
    prisma.user.findMany({
      where: { role: { not: "admin" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, email: true, createdAt: true },
    }),
    // Full generations (deck.generate — new decks AND full regens) + partial
    // per-slide regens. One Job row per run; carries the flow type (via
    // project.type), the generator (project.user.email), completion time, and
    // the credit-hold key for cost.
    prisma.job.findMany({
      where: {
        type: { in: ["deck.generate", "deck.regenerate.partial"] },
        status: "succeeded",
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        attempts: true,
        holdKey: true,
        completedAt: true,
        createdAt: true,
        project: { select: { type: true, user: { select: { email: true } } } },
      },
    }),
    prisma.topupGrant.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, amountGranted: true, createdAt: true, user: { select: { email: true } } },
    }),
  ]);

  // Join each generation/regen to its CreditHold for cost + start time. Full
  // generations charge under jobKey === Job.id; partial regens under the stored
  // holdKey (`regen:<versionId>`). Admin-waived runs have no hold row (free).
  const holdKeys = jobs.map((j) => j.holdKey ?? j.id);
  const holds = holdKeys.length
    ? await prisma.creditHold.findMany({
        where: { jobKey: { in: holdKeys }, status: "settled" },
        select: { jobKey: true, amountCharged: true, createdAt: true },
      })
    : [];
  const holdByKey = new Map(holds.map((h) => [h.jobKey, h]));

  const genEvents = jobs.map((j) => {
    const isPartial = j.type === "deck.regenerate.partial";
    const hold = holdByKey.get(j.holdKey ?? j.id);
    // The hold is created at generation start (after the queue), so it doubles
    // as the precise start time.
    const cost = hold ? `${fmt(hold.amountCharged ?? 0)} cr` : "Free";
    const duration =
      hold && j.completedAt
        ? formatDuration(j.completedAt.getTime() - hold.createdAt.getTime())
        : null;
    const text = isPartial
      ? `Partial regen · ${fmt(j.attempts)} ${j.attempts === 1 ? "slide" : "slides"}`
      : `${FLOW_LABEL[j.project?.type ?? "create"] ?? "Deck"} deck generated`;
    return {
      date: j.createdAt,
      item: {
        id: `j-${j.id}`,
        kind: (isPartial ? "regen" : "generation") as ActivityItem["kind"],
        text,
        at: timeAgo(j.createdAt),
        email: j.project?.user?.email ?? undefined,
        cost,
        duration,
      },
    };
  });

  const events: { date: Date; item: ActivityItem }[] = [
    ...signups.map((u) => ({
      date: u.createdAt,
      item: { id: `s-${u.id}`, kind: "signup" as const, text: `${u.email} signed up`, at: timeAgo(u.createdAt) },
    })),
    ...genEvents,
    ...purchases.map((t) => ({
      date: t.createdAt,
      item: { id: `p-${t.id}`, kind: "purchase" as const, text: `${t.user.email} bought ${fmt(t.amountGranted)} credits`, at: timeAgo(t.createdAt) },
    })),
  ];

  return events
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 8)
    .map((e) => e.item);
}
