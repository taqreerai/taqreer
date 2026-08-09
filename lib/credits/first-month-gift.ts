// One-time "first month" retention gift (2026-08-09).
//
// A paid subscriber who burns through their credits inside the first
// month of their first-ever subscription gets a single automatic
// 600-credit top-up + the credit-gift email. 600 covers the average
// paid deck measured on prod (weighted avg ~588 over the trailing 30
// days, mostly sonnet-fast), so "your next presentation is on us" in
// the email copy is literally true for the typical user.
//
// Flow: the settle/charge paths call queueFirstMonthGiftCheck()
// fire-and-forget; it runs the CHEAP eligibility checks and, when they
// pass, emits `credits.firstmonth.gift.requested`. The Inngest
// function (inngest/functions/first-month-gift.ts) sleeps 10 minutes -
// an instant grant at the exact second the balance dies reads as a
// vending machine, a short delay reads as a considered gesture - then
// re-runs the FULL check and grants. Inngest owns the delay so a
// deploy/restart can never drop a pending gift the way a setTimeout
// would.
//
// Guardrails, in check order (cheapest first):
//   1. Once EVER per user - the `firstmonth-gift:<userId>` sourceKey
//      rides TopupGrant's unique constraint, the same idempotency
//      mechanism admin grants use. A resubscribe can never re-earn it.
//   2. Paid + active subscription only. Free users are excluded on
//      purpose: their empty-balance moment is the upgrade decision,
//      and an automatic burn-to-earn loop is farmable (see the
//      signup-fraud history).
//   3. Balance below the cheapest possible generation (min active
//      preset base + 1 slide, from live config) - "used all his
//      credits" made deterministic. Re-checked after the delay: a user
//      who bought a top-up during the 10 minutes no longer needs the
//      gesture.
//   4. Inside the first month of the subscription, verified against
//      Stripe's authoritative start_date (no local mirror exists, and
//      Subscription.createdAt is the row's creation - often the FREE
//      signup - not the paid start). One Stripe read, and only on the
//      rare path where checks 1-3 all passed.

import { prisma } from "@/lib/prisma";
import { grantTopup, getBalance } from "@/lib/credits/server";
import { ensureFresh, getActivePresets } from "@/lib/config/runtime-config";
import { dispatchCreditGiftEmail } from "@/lib/email/send-credit-gift";
import { inngest } from "@/inngest/client";

export const FIRST_MONTH_GIFT_CREDITS = 600;
export const FIRST_MONTH_GIFT_EVENT = "credits.firstmonth.gift.requested";
const FIRST_MONTH_WINDOW_DAYS = 32;

function sourceKeyFor(userId: string): string {
  return `firstmonth-gift:${userId}`;
}

// Checks 1-3 (local DB + config only - no Stripe round-trip). Shared
// by the pre-queue gate and the post-delay re-check.
async function locallyEligible(userId: string): Promise<boolean> {
  const already = await prisma.topupGrant.findUnique({
    where: { sourceKey: sourceKeyFor(userId) },
    select: { id: true },
  });
  if (already) return false;

  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, status: true, stripeSubscriptionId: true },
  });
  if (
    !sub ||
    sub.plan === "free" ||
    sub.status !== "active" ||
    !sub.stripeSubscriptionId
  ) {
    return false;
  }

  await ensureFresh();
  const cheapestGeneration = Math.min(
    ...getActivePresets().map((p) => p.baseCredits + p.perSlideCredits),
  );
  const balance = await getBalance(userId);
  return balance.total < cheapestGeneration;
}

/**
 * Fire-and-forget entry point for the settle/charge hooks: when the
 * cheap checks pass, queue the delayed Inngest gift check. The event id
 * dedupes repeat sends (several broke-state regens in a row) inside
 * Inngest's dedupe window; the sourceKey remains the once-ever truth.
 * Never throws.
 */
export async function queueFirstMonthGiftCheck(userId: string): Promise<void> {
  try {
    if (!(await locallyEligible(userId))) return;
    await inngest.send({
      name: FIRST_MONTH_GIFT_EVENT,
      id: sourceKeyFor(userId),
      data: { userId },
    });
  } catch (err) {
    console.error(
      "[first-month-gift] queue failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * The full post-delay check + grant (NO email - the Inngest function
 * sends it in its own memoized step so an email retry can never
 * re-grant, and a grant can never be lost to an email hiccup).
 * Returns the number of credits granted (0 = ineligible or already
 * granted). Throws on transient failures so Inngest retries.
 */
export async function grantFirstMonthGift(userId: string): Promise<number> {
  if (!(await locallyEligible(userId))) return 0;

  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true },
  });
  if (!sub?.stripeSubscriptionId) return 0;
  const { stripe } = await import("@/lib/billing/stripe");
  const stripeSub = await stripe.subscriptions.retrieve(
    sub.stripeSubscriptionId,
  );
  const ageMs = Date.now() - stripeSub.start_date * 1000;
  if (ageMs > FIRST_MONTH_WINDOW_DAYS * 24 * 60 * 60 * 1000) return 0;

  const res = await grantTopup({
    userId,
    credits: FIRST_MONTH_GIFT_CREDITS,
    sourceKey: sourceKeyFor(userId),
    notify: true,
  });
  if (res.granted > 0) {
    console.info("[first-month-gift] granted", res.granted, "to", userId);
  }
  return res.granted;
}

/** Send the gift email (default copy - no reason line). */
export async function sendFirstMonthGiftEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, language: true },
  });
  if (!user) return;
  await dispatchCreditGiftEmail({
    toEmail: user.email,
    locale: user.language,
    appOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai",
    credits: FIRST_MONTH_GIFT_CREDITS,
  });
}
