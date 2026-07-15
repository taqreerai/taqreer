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

// ─── KPI sparklines + deltas ────────────────────────────────────────────────
// Real trend series derived from existing rows (no snapshot table needed) for
// the metrics that have a natural time-axis: total users (cumulative stock),
// decks/day and credits-spent/day (flow). Subs + Stripe balance have no
// historical series in our data, so those cards stay value-only.
// Matches the "(30d)" KPI windows so a card's number and its sparkline/delta
// cover the same period.
const SPARK_DAYS = 30;

type Trend = { spark: number[]; delta?: string; trend?: "up" | "down" | "flat" };

// Bucket dated, optionally-weighted items into SPARK_DAYS daily totals.
function bucketDaily(
  items: { t: number; w?: number }[],
  windowStartMs: number,
): number[] {
  const b = new Array(SPARK_DAYS).fill(0) as number[];
  for (const it of items) {
    const idx = Math.floor((it.t - windowStartMs) / DAY_MS);
    if (idx >= 0 && idx < SPARK_DAYS) b[idx] += it.w ?? 1;
  }
  return b;
}

// Percentage change → "+8.2%" / "-2.4%" + trend. No baseline ⇒ no delta.
function trendFrom(prev: number, curr: number): Omit<Trend, "spark"> {
  if (!Number.isFinite(prev) || prev <= 0) return {};
  const pct = ((curr - prev) / prev) * 100;
  return {
    delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    trend: pct > 0.1 ? "up" : pct < -0.1 ? "down" : "flat",
  };
}

// Flow metrics: recent-half sum vs earlier-half sum (this week vs last).
function flowTrend(spark: number[]): Omit<Trend, "spark"> {
  const h = Math.floor(spark.length / 2);
  const prev = spark.slice(0, h).reduce((a, b) => a + b, 0);
  const curr = spark.slice(h).reduce((a, b) => a + b, 0);
  return trendFrom(prev, curr);
}

// Stock metrics (cumulative totals): latest value vs the window midpoint
// (recent-half growth). When the midpoint is still zero — the app is younger
// than half the window, so the series starts at 0 — fall back to the first day
// that had data, so a young metric still shows a growth % instead of nothing.
function stockTrend(spark: number[]): Omit<Trend, "spark"> {
  const mid = Math.floor(spark.length / 2);
  const prev = spark[mid] > 0 ? spark[mid] : (spark.find((v) => v > 0) ?? 0);
  return trendFrom(prev, spark.at(-1) ?? 0);
}

async function getStatTrends(): Promise<{
  users: Trend;
  subs: Trend;
  decks: Trend;
  credits: Trend;
}> {
  const now = Date.now();
  const windowStartMs = now - SPARK_DAYS * DAY_MS;
  const windowStart = new Date(windowStartMs);

  const [usersBaseline, newUsers, newDecks, spentRows, activeSubs] =
    await Promise.all([
      prisma.user.count({
        where: { role: { not: "admin" }, createdAt: { lt: windowStart } },
      }),
      prisma.user.findMany({
        where: { role: { not: "admin" }, createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      prisma.presentation.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      prisma.creditHold.findMany({
        where: { status: "settled", createdAt: { gte: windowStart } },
        select: { createdAt: true, amountCharged: true },
      }),
      // Currently-active paid subs, by createdAt — see the subs note below.
      prisma.subscription.findMany({
        where: { status: "active", plan: { in: [...PAID_PLANS] } },
        select: { createdAt: true },
      }),
    ]);

  // Users — cumulative daily total (running total from the pre-window count).
  let running = usersBaseline;
  const usersSpark = bucketDaily(
    newUsers.map((u) => ({ t: u.createdAt.getTime() })),
    windowStartMs,
  ).map((n) => (running += n));

  // Decks — new decks per day (flow).
  const decksSpark = bucketDaily(
    newDecks.map((p) => ({ t: p.createdAt.getTime() })),
    windowStartMs,
  );

  // Credits — settled charges summed per day (flow).
  const creditsSpark = bucketDaily(
    spentRows.map((r) => ({ t: r.createdAt.getTime(), w: r.amountCharged ?? 0 })),
    windowStartMs,
  );

  // Subs — APPROXIMATE active-over-time: for each day, count the subs that are
  // active NOW and were created on/before that day. There's no cancel
  // timestamp, so this can't see subs that were active then but have since
  // churned — it undercounts past days (the line only rises to the current
  // count). A rough trend indicator; the card value is the exact count.
  const subsSpark: number[] = [];
  for (let i = SPARK_DAYS - 1; i >= 0; i--) {
    const dayEndMs = now - i * DAY_MS;
    subsSpark.push(
      activeSubs.filter((s) => s.createdAt.getTime() <= dayEndMs).length,
    );
  }

  return {
    users: { spark: usersSpark, ...stockTrend(usersSpark) },
    subs: { spark: subsSpark, ...stockTrend(subsSpark) },
    decks: { spark: decksSpark, ...flowTrend(decksSpark) },
    credits: { spark: creditsSpark, ...flowTrend(creditsSpark) },
  };
}

// Real current LIVE Stripe account balance (available + pending) in USD.
// Live-only: with no live key in this environment (e.g. local dev on test keys)
// it returns null and the card shows "n/a" rather than a test-mode figure. Also
// resilient - a Stripe hiccup returns null instead of blanking the Overview.
// Current LIVE Stripe balance (USD) + an approximate daily-balance sparkline
// reconstructed from balance transactions over the window: balance at end of
// day D =
// current balance minus the net of every transaction created after D. Uses
// `amount` by `created`, so it ignores available/pending timing — a trend
// indicator, not an exact ledger. Live-only: null spark (card shows "n/a" and
// no line) with test keys or on any Stripe hiccup.
async function getBalanceTrend(): Promise<{ usd: number | null } & Trend> {
  const client = getLiveStripeOrNull();
  if (!client) return { usd: null, spark: [] };
  try {
    const bal = await client.balance.retrieve();
    const cents = [...bal.available, ...bal.pending]
      .filter((b) => b.currency === "usd")
      .reduce((sum, b) => sum + b.amount, 0);

    const sinceSec = Math.floor((Date.now() - SPARK_DAYS * DAY_MS) / 1000);
    // Auto-paginate so a busy account doesn't miss older transactions in the
    // window (a single page caps at 100). Hard cap as a runaway backstop.
    const usdTxns: { created: number; amount: number }[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const t of client.balanceTransactions.list({
      created: { gte: sinceSec },
      limit: 100,
    })) {
      if (++scanned > 2000) {
        truncated = true;
        break;
      }
      if (t.currency === "usd") {
        usdTxns.push({ created: t.created, amount: t.amount });
      }
    }
    // A truncated scan means incomplete history, which would draw a misleading
    // line — keep the current balance figure but drop the sparkline.
    if (truncated) return { usd: cents / 100, spark: [] };

    const spark: number[] = [];
    for (let i = SPARK_DAYS - 1; i >= 0; i--) {
      const dayEndSec = Math.floor((Date.now() - i * DAY_MS) / 1000);
      const laterCents = usdTxns
        .filter((t) => t.created > dayEndSec)
        .reduce((a, t) => a + t.amount, 0);
      spark.push((cents - laterCents) / 100);
    }
    return { usd: cents / 100, spark, ...trendFrom(spark[0], spark.at(-1) ?? 0) };
  } catch (err) {
    console.error("[admin/stats] stripe balance/trend fetch failed", err);
    return { usd: null, spark: [] };
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

  const [
    totalUsers,
    planGroups,
    activeSubsCount,
    decks30,
    spent,
    balance,
    trends,
  ] = await Promise.all([
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
    getBalanceTrend(),
    // Sparklines are non-critical: a trend-query hiccup must not take down the
    // whole KPI overview — fall back to value-only cards (empty spark).
    getStatTrends().catch((err) => {
      console.error("[admin/stats] stat trends failed", err);
      const empty: Trend = { spark: [] };
      return { users: empty, subs: empty, decks: empty, credits: empty };
    }),
  ]);

  const planSplit: Record<Plan, number> = { free: 0, plus: 0, pro: 0, max: 0 };
  for (const g of planGroups) {
    if (g.plan in planSplit) planSplit[g.plan as Plan] = g._count._all;
  }

  const creditsSpent30 = spent._sum.amountCharged ?? 0;

  const stats: AdminStat[] = [
    { key: "users", label: "Total users", value: fmt(totalUsers), spark: trends.users.spark, delta: trends.users.delta, trend: trends.users.trend },
    // Subs sparkline is an approximation (no historical churn — see
    // getStatTrends); balance sparkline is reconstructed from Stripe and is
    // live-only (empty spark ⇒ value-only card with test keys).
    { key: "subs", label: "Active subscriptions", value: fmt(activeSubsCount), spark: trends.subs.spark, delta: trends.subs.delta, trend: trends.subs.trend },
    {
      key: "balance",
      label: "Stripe balance",
      value:
        balance.usd === null
          ? "n/a"
          : `$${balance.usd.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
      spark: balance.spark,
      delta: balance.delta,
      trend: balance.trend,
    },
    { key: "decks", label: "Decks generated (30d)", value: fmt(decks30), spark: trends.decks.spark, delta: trends.decks.delta, trend: trends.decks.trend },
    { key: "credits", label: "Credits spent (30d)", value: fmt(creditsSpent30), spark: trends.credits.spark, delta: trends.credits.delta, trend: trends.credits.trend },
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
      // By completion (nulls last), so a recently-finished job that was queued
      // earlier isn't dropped; createdAt is the tiebreaker + orders legacy rows
      // that predate the completedAt column.
      orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
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
    // Date/time the row by when the deck finished, not when it was enqueued
    // (createdAt is queue time). Falls back to createdAt for rows generated
    // before completedAt was recorded.
    const eventDate = j.completedAt ?? j.createdAt;
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
      date: eventDate,
      item: {
        id: `j-${j.id}`,
        kind: (isPartial ? "regen" : "generation") as ActivityItem["kind"],
        text,
        at: timeAgo(eventDate),
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
