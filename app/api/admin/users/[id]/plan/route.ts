// POST /api/admin/users/[id]/plan - admin grants a user a complimentary paid
// tier for 1 month (no Stripe). The tier + its credits go live immediately;
// the daily credits-maintenance cron reverts the user to free once the comp
// window passes (User.planCompExpiresAt).
//
// Admin-only (requireAdminApi). Refuses "free" and refuses a user with a live
// Stripe subscription (a webhook would clobber the comp - handle billing
// directly instead). Fires the comp-tier announcement email (fire-and-forget,
// per-user language). Audited via UsageEvent "credit.comp.granted".

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { grantCompTier, CompActiveSubscriptionError } from "@/lib/credits/server";
import { dispatchCompTierEmail } from "@/lib/email/send-comp-tier";
import { normalizePlan } from "@/lib/plan";

// One month, fixed (product decision 2026-07-14).
const COMP_MONTHS = 1;

// Latin product names, identical in both locales (the email keeps them LTR).
const TIER_LABEL: Record<"plus" | "pro" | "max", string> = {
  plus: "Plus",
  pro: "Pro",
  max: "Max",
};

// Add whole months, clamping the day so a late-month grant (e.g. Jan 31)
// lands on the last day of the target month, not spilling into the next.
function addMonthsClamped(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { plan?: string } | null;

  const plan = normalizePlan(body?.plan ?? "");
  if (plan === "free") {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      language: true,
      subscriptions: { select: { status: true, stripeSubscriptionId: true } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  // A live Stripe subscription would re-assert User.plan via webhook and
  // clobber the comp - refuse rather than silently fight it.
  const liveSub = target.subscriptions.find(
    (s) => s.stripeSubscriptionId && s.status !== "canceled",
  );
  if (liveSub) {
    return NextResponse.json(
      { error: "has_active_subscription" },
      { status: 409 },
    );
  }

  const expiresAt = addMonthsClamped(new Date(), COMP_MONTHS);

  let balance;
  try {
    balance = await grantCompTier({
      userId: id,
      plan,
      expiresAt,
      adminUserId: ctx.userId,
      notify: true,
    });
  } catch (err) {
    // The in-transaction guard found a live subscription that slipped in
    // after the pre-check above - same 409 as the pre-check.
    if (err instanceof CompActiveSubscriptionError) {
      return NextResponse.json(
        { error: "has_active_subscription" },
        { status: 409 },
      );
    }
    throw err;
  }

  // Announcement email - fire-and-forget, never blocks (or fails) the grant.
  void dispatchCompTierEmail({
    toEmail: target.email,
    locale: target.language,
    appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
    tierLabel: TIER_LABEL[plan],
  });

  return NextResponse.json({
    ok: true,
    plan,
    expiresAt: expiresAt.toISOString(),
    balance,
  });
}
