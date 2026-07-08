// GET /api/credits - the single read surface for every credit UI
// (avatar ring, profile-popup breakdown, settings card). All three
// render from this one payload + the `credit.balance.changed`
// broadcast, so they can never disagree.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plan";
import { getBalance } from "@/lib/credits/server";
import {
  ensureFresh,
  getFreeCredits,
  getActivePresets,
  getTier,
  getImageCredits,
  pricingDisplayNumbers,
  defaultPresetKey,
} from "@/lib/config/runtime-config";
import { TIER_ORDER, SYSTEM_SLIDE_CAP } from "@/lib/credits/cost";
import {
  getDisplayPrices,
  getTopupDisplayPacks,
} from "@/lib/billing/display-prices";

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
  await ensureFresh();
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
        ? getFreeCredits()
        : 0;
  const capacity = Math.max(
    balance.total,
    cycleGrant + (topupGranted._sum.amountGranted ?? 0),
  );

  // Active generation presets for the picker (DB-driven). Each carries its DB
  // cost + the lowest tier that unlocks it, so GenerateSplitButton shows exactly
  // what the server will charge and gate on. Inactive presets are absent here,
  // so they disappear from the picker; an added preset appears with no deploy.
  const presets = getActivePresets().map((p) => ({
    key: p.key,
    label: p.label,
    thinking: p.thinking,
    effort: p.effort ?? null,
    baseCredits: p.baseCredits,
    perSlideCredits: p.perSlideCredits,
    gateTier:
      TIER_ORDER.find((plan) =>
        getTier(plan).unlockedPresetKeys.includes(p.key),
      ) ?? null,
  }));

  const [tierPrices, topupPacks] = await Promise.all([
    getDisplayPrices(),
    getTopupDisplayPacks(),
  ]);

  return NextResponse.json({
    plan,
    isAdmin: dbUser.role === "admin",
    // Per-run slide ceiling for this user's tier (admin -> the 75 system cap).
    // The slide steppers cap their max here so a free user (10) can't pick a
    // count preflight would reject.
    slideCap: dbUser.role === "admin" ? SYSTEM_SLIDE_CAP : getTier(plan).slideCap,
    cadence: dbUser.subscriptions[0]?.cadence ?? null,
    presets,
    // The server's default preset key, so the picker can reconcile a stale
    // selection (a retired preset) to what the server would coerce to.
    defaultPresetKey: defaultPresetKey(),
    // Credits per generated image (images-mode surcharge) - the DB knob,
    // so the client estimate holds parity with the server quote.
    imageCredits: getImageCredits(),
    // Per-tier display numbers (free signup grant / paid monthly allotment +
    // slide cap) so BillingSection's /plans + UpgradeModal cards track admin
    // Settings like the landing, instead of frozen literals.
    tierNumbers: pricingDisplayNumbers(),
    // Live Stripe prices (the actual charge) for the in-app plan cards.
    tierPrices,
    // Live top-up packs (credits + price from Stripe by lookup_key, catalog
    // fallback) so the pack cards track Stripe instead of the constant.
    topupPacks,
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
