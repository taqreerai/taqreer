// Simulation harness for the first-month gift (PR #191). LOCAL DEV ONLY:
// refuses to run against a non-localhost DATABASE_URL. Seeds a paid
// first-month subscriber with an exhausted balance and calls the REAL
// queueFirstMonthGiftCheck entry point - no deck generation involved.
// The Inngest dev server then owns the 10-minute sleep + grant + email.
//
//   npx tsx scripts/sim-first-month-gift.ts <email>
//
// Stripe side: creates a test-mode trialing subscription (no payment
// method needed) so grantFirstMonthGift's start_date check reads a real,
// fresh subscription. Re-runnable: deletes any prior firstmonth-gift
// grant for the user first.

import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: npx tsx scripts/sim-first-month-gift.ts <email>");
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("refusing: DATABASE_URL is not localhost (local dev only)");
  }

  const { prisma } = await import("@/lib/prisma");
  const { stripe } = await import("@/lib/billing/stripe");
  const { queueFirstMonthGiftCheck } = await import("@/lib/credits/first-month-gift");

  // ── Local user ──
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, language: "ar" },
  });
  console.log("user:", user.id, user.email, user.language);

  // ── Fresh test-mode Stripe subscription (trialing, start_date = now) ──
  const customer = await stripe.customers.create({
    email,
    metadata: { sim: "first-month-gift" },
  });
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: 900,
    recurring: { interval: "month" },
    product_data: { name: "sim-first-month-gift plus" },
  });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id }],
    trial_period_days: 7,
  });
  console.log("stripe sub:", sub.id, "start_date:", new Date(sub.start_date * 1000).toISOString());

  // ── Paid + active subscription row, low balance, clean slate ──
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: { plan: "plus", status: "active", stripeSubscriptionId: sub.id, stripeCustomerId: customer.id },
    create: { userId: user.id, plan: "plus", status: "active", stripeSubscriptionId: sub.id, stripeCustomerId: customer.id },
  });
  await prisma.creditAccount.upsert({
    where: { userId: user.id },
    update: { subscriptionBalance: 50, monthlyAllotment: 4000 },
    create: { userId: user.id, subscriptionBalance: 50, monthlyAllotment: 4000 },
  });
  // Expire any topups + remove a prior sim gift so the run is clean.
  await prisma.topupGrant.deleteMany({ where: { userId: user.id } });
  console.log("seeded: plan=plus active, balance=50, no topups");

  // ── The real entry point the settle/charge hooks call ──
  await queueFirstMonthGiftCheck(user.id);
  console.log("queueFirstMonthGiftCheck called - check the Inngest dev UI (:8288) for the queued run");
  console.log("watch for TopupGrant sourceKey:", `firstmonth-gift:${user.id}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
