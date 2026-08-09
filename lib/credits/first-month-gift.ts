// One-time "first month" retention gift (2026-08-09).
//
// A paid subscriber who burns through their credits inside the first
// month of their first-ever subscription gets a single automatic
// 600-credit top-up + the credit-gift email. 600 covers the average
// paid deck measured on prod (weighted avg ~588 over the trailing 30
// days, mostly sonnet-fast), so "your next presentation is on us" in
// the email copy is literally true for the typical user.
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
//      credits" made deterministic.
//   4. Inside the first month of the subscription, verified against
//      Stripe's authoritative start_date (no local mirror exists, and
//      Subscription.createdAt is the row's creation - often the FREE
//      signup - not the paid start). One Stripe read, and only on the
//      rare path where checks 1-3 all passed.
//
// Callers fire-and-forget from the settle/charge paths; this function
// must never throw into a credits transaction.

import { prisma } from "@/lib/prisma";
import { grantTopup, getBalance } from "@/lib/credits/server";
import { ensureFresh, getActivePresets } from "@/lib/config/runtime-config";
import { dispatchCreditGiftEmail } from "@/lib/email/send-credit-gift";

export const FIRST_MONTH_GIFT_CREDITS = 600;
const FIRST_MONTH_WINDOW_DAYS = 32;

export async function maybeFirstMonthGift(userId: string): Promise<void> {
  try {
    const sourceKey = `firstmonth-gift:${userId}`;
    const already = await prisma.topupGrant.findUnique({
      where: { sourceKey },
      select: { id: true },
    });
    if (already) return;

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
      return;
    }

    await ensureFresh();
    const cheapestGeneration = Math.min(
      ...getActivePresets().map((p) => p.baseCredits + p.perSlideCredits),
    );
    const balance = await getBalance(userId);
    if (balance.total >= cheapestGeneration) return;

    const { stripe } = await import("@/lib/billing/stripe");
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );
    const ageMs = Date.now() - stripeSub.start_date * 1000;
    if (ageMs > FIRST_MONTH_WINDOW_DAYS * 24 * 60 * 60 * 1000) return;

    const res = await grantTopup({
      userId,
      credits: FIRST_MONTH_GIFT_CREDITS,
      sourceKey,
      notify: true,
    });
    if (res.granted === 0) return;

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
    console.info("[first-month-gift] granted", FIRST_MONTH_GIFT_CREDITS, "to", userId);
  } catch (err) {
    console.error(
      "[first-month-gift] check failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
