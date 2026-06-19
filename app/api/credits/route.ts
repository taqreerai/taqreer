// GET /api/credits - the single read surface for every credit UI
// (avatar ring, profile-popup breakdown, settings card). All three
// render from this one payload + the `credit.balance.changed`
// broadcast, so they can never disagree.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plan";
import { getBalance } from "@/lib/credits/server";
import { TIERS } from "@/lib/credits/cost";

// Recent ledger entries for the popup's "recent usage" list. Holds are
// transient (they settle into a charge or a release), so the list shows
// the FINAL movements only.
const RECENT_EVENT_TYPES = [
  "credit.settle",
  "credit.release",
  "credit.charge",
  "credit.grant.signup",
  "credit.grant.subscription",
  "credit.grant.topup",
  "credit.reset",
  "credit.expire_topup",
];
const RECENT_LIMIT = 5;

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
    select: {
      id: true,
      plan: true,
      // Superuser flag → the chrome swaps the plan/credit UI for an
      // "Admin" chip and the client picker treats everything unlocked.
      role: true,
      // Cadence of the active paid subscription → the plan banner's
      // monthly/yearly pill (PlanUsage reads it from this one payload).
      subscriptions: { select: { cadence: true } },
    },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = normalizePlan(dbUser.plan);
  const now = new Date();
  const [balance, account, recent, topupGranted] = await Promise.all([
    getBalance(dbUser.id, now),
    prisma.creditAccount.findUnique({
      where: { userId: dbUser.id },
      select: { signupGrantedAt: true },
    }),
    prisma.usageEvent.findMany({
      where: { userId: dbUser.id, eventType: { in: RECENT_EVENT_TYPES } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        eventType: true,
        amount: true,
        metadata: true,
        createdAt: true,
      },
    }),
    // Active top-up principal - the ring's denominator counts what the
    // user actually has access to this cycle (allotment + live packs).
    prisma.topupGrant.aggregate({
      where: {
        userId: dbUser.id,
        amountRemaining: { gt: 0 },
        expiresAt: { gt: now },
      },
      _sum: { amountGranted: true },
    }),
  ]);

  // The ring's "used vs remaining" denominator: the cycle's grant
  // (monthly allotment, or the one-time signup grant for Free) plus
  // the granted principal of still-active top-up packs. The Free
  // signup grant only counts if it was actually ISSUED - accounts
  // predating the grant wiring have signupGrantedAt null, and adding
  // a phantom 400 made the ring read "340 / 900" after a 500 top-up
  // (user-reported 2026-06-12).
  const cycleGrant =
    balance.monthlyAllotment > 0
      ? balance.monthlyAllotment
      : account?.signupGrantedAt
        ? TIERS.free.signupGrant
        : 0;
  const capacity = Math.max(
    balance.total,
    cycleGrant + (topupGranted._sum.amountGranted ?? 0),
  );

  return NextResponse.json({
    plan,
    isAdmin: dbUser.role === "admin",
    cadence: dbUser.subscriptions[0]?.cadence ?? null,
    balance: {
      total: balance.total,
      subscription: balance.subscription,
      topup: balance.topup,
      monthlyAllotment: balance.monthlyAllotment,
      allotmentResetAt: balance.allotmentResetAt?.toISOString() ?? null,
    },
    capacity,
    recent: recent.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      amount: event.amount,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
