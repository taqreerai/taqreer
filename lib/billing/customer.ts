// Resolve (find-or-create) the Stripe customer for a Prisma user, and
// keep the local Subscription mirror row in sync. The Subscription row
// is this user's billing record - created lazily on first checkout even
// for a top-up-only purchase (plan stays "free" until a subscription
// webhook flips it). stripeCustomerId is the durable link.

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/billing/stripe";

export async function getOrCreateStripeCustomer(args: {
  prismaUserId: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  const existing = await prisma.subscription.findUnique({
    where: { userId: args.prismaUserId },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: args.email,
    name: args.name ?? undefined,
    // Stripe -> our user back-reference. The webhook reads this when an
    // event only carries the customer id.
    metadata: { prismaUserId: args.prismaUserId },
  });

  // Claim the slot transactionally (CR PR#57): two concurrent
  // first-time requests each create a Stripe customer; without the
  // re-check the later upsert silently overwrote the earlier id and a
  // SetupIntent confirmed against the orphan broke default-card +
  // renewal flows. Now the FIRST claim wins and the loser deletes its
  // own just-created customer.
  const claimedId = await prisma.$transaction(async (tx) => {
    const current = await tx.subscription.findUnique({
      where: { userId: args.prismaUserId },
      select: { stripeCustomerId: true },
    });
    if (current?.stripeCustomerId) return current.stripeCustomerId;
    await tx.subscription.upsert({
      where: { userId: args.prismaUserId },
      update: { stripeCustomerId: customer.id },
      create: {
        userId: args.prismaUserId,
        stripeCustomerId: customer.id,
        plan: "free",
        status: "active",
      },
    });
    return customer.id;
  });
  if (claimedId !== customer.id) {
    // Lost the race - remove the orphan so no card can attach to it.
    await stripe.customers.del(customer.id).catch(() => {});
  }
  return claimedId;
}
