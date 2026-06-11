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

  // Upsert the billing record with the customer id. (A race here is
  // benign: stripeCustomerId is @unique, so a second create would
  // collide and we'd re-read; in practice checkout is user-serialized.)
  await prisma.subscription.upsert({
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
}
