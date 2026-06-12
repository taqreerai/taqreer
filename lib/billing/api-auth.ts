// Shared guard for the embedded-billing API routes (payment methods,
// invoices, subscription cancel/resume). Resolves the Supabase session
// to the Prisma user + their Subscription mirror row. Every route is
// scoped to the CALLER's stripeCustomerId - client input never selects
// the customer.

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type BillingCaller = {
  userId: string;
  /** Null when the user never reached Stripe (free, no purchases). */
  customerId: string | null;
  /** Null when the user has no recurring subscription. */
  subscriptionId: string | null;
};

export async function getBillingCaller(): Promise<BillingCaller | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true, subscriptions: { take: 1 } },
  });
  if (!dbUser) return null;

  const sub = dbUser.subscriptions[0] ?? null;
  return {
    userId: dbUser.id,
    customerId: sub?.stripeCustomerId ?? null,
    subscriptionId: sub?.stripeSubscriptionId ?? null,
  };
}
