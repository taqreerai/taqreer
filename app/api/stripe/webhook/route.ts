// POST /api/stripe/webhook
//
// The ONLY thing that moves money state. Stripe events trigger ledger
// grants + Subscription-mirror writes; the client never grants. Every
// handler is idempotent:
//   - StripeWebhookEvent row (insert-or-skip) makes the whole handler
//     exactly-once across Stripe's aggressive retries.
//   - grantTopup (sourceKey) + grantSubscriptionCycle are themselves
//     idempotent, so even a torn handler can't double-credit.
//
// Signature-verified with STRIPE_WEBHOOK_SECRET against the RAW body
// (Next must not parse it - we read request.text()).
//
// Event → action (billing plan §4):
//   checkout.session.completed      → subscription grant OR top-up grant
//   invoice.payment_succeeded       → renewal reset (re-grant the cycle)
//   customer.subscription.updated   → plan change / cancel-at-period-end
//   customer.subscription.deleted   → downgrade to Free (balance kept)
//   invoice.payment_failed          → mark past_due (dunning banner)
//   charge.refunded                 → (logged; manual refund handling
//                                      lands with the admin panel)

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/billing/stripe";
import {
  parseGrantMetadata,
  specByLookupKey,
  type BillingCadence,
} from "@/lib/billing/prices";
import {
  grantTopup,
  grantSubscriptionCycle,
  changePlanKeepBalance,
} from "@/lib/credits/server";
import { fanOutNotification } from "@/lib/notifications/server";
import type { KnownPlan } from "@/lib/plan";

// Next.js App Router: raw body for signature verification.
export const runtime = "nodejs";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/** Mark an event handled; false if it was already processed. */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: { id: event.id, type: event.type },
    });
    return true;
  } catch {
    // Unique-violation = duplicate delivery; skip.
    return false;
  }
}

async function notifyCredited(
  prismaUserId: string,
  credits: number,
  reason: "renewal" | "topup" | "welcome",
): Promise<void> {
  await fanOutNotification({
    type: "billing.credited",
    projectId: null,
    actorPrismaUserId: null,
    recipientUserIds: [prismaUserId],
    allowSelfEcho: true,
    payload: { credits, reason },
  }).catch(() => {});
}

// Resolve our Prisma user from a Stripe customer id (set on the
// Subscription mirror at customer-create time, and on the customer's
// metadata as a fallback).
async function prismaUserIdForCustomer(
  customerId: string,
): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  if (sub) return sub.userId;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      const id = (customer.metadata as Record<string, string>)?.prismaUserId;
      return id || null;
    }
  } catch {
    /* customer gone */
  }
  return null;
}

export async function POST(request: Request) {
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const sig = request.headers.get("stripe-signature");
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? "", WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : "?"}` },
      { status: 400 },
    );
  }

  // Always 200 below this point unless a handler genuinely fails - a
  // 4xx/5xx makes Stripe retry, which we only want on real failures.
  if (!(await claimEvent(event))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const prismaUserId =
          (session.metadata as Record<string, string>)?.prismaUserId ?? null;
        const grant = parseGrantMetadata(
          session.metadata as Record<string, string>,
        );
        if (!prismaUserId || !grant) break;

        if (grant.kind === "topup") {
          const result = await grantTopup({
            userId: prismaUserId,
            credits: grant.credits,
            // Idempotency anchor: the Checkout Session id is one-time.
            sourceKey: session.id,
          });
          if (result.granted > 0) {
            await notifyCredited(prismaUserId, grant.credits, "topup");
          }
        } else {
          // Subscription: the subscription object carries the period
          // end + price; grant the cycle. invoice.payment_succeeded
          // also fires - both call grantSubscriptionCycle (a SET, not
          // an ADD), so the double is harmless.
          await applySubscriptionGrant(
            prismaUserId,
            session.subscription as string | null,
            grant.plan,
          );
          // Purchase/upgrade activation - tell the user (renewals are
          // covered by invoice.payment_succeeded's "credited" path;
          // this session-scoped emit fires once per checkout).
          const { TIERS } = await import("@/lib/credits/cost");
          await fanOutNotification({
            type: "billing.plan_changed",
            projectId: null,
            actorPrismaUserId: null,
            recipientUserIds: [prismaUserId],
            allowSelfEcho: true,
            payload: {
              plan: grant.plan,
              credits: TIERS[grant.plan].monthlyAllotment,
            },
          }).catch(() => {});
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : null;
        const subId = invoiceSubscriptionId(invoice);
        if (!customerId || !subId) break;
        const prismaUserId = await prismaUserIdForCustomer(customerId);
        if (!prismaUserId) break;
        const plan = await planFromSubscription(subId);
        if (!plan) break;
        const isRenewal = invoice.billing_reason === "subscription_cycle";
        await applySubscriptionGrant(prismaUserId, subId, plan);
        if (isRenewal) {
          const { TIERS } = await import("@/lib/credits/cost");
          await notifyCredited(prismaUserId, TIERS[plan].monthlyAllotment, "renewal");
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const prismaUserId = await prismaUserIdForCustomer(
          sub.customer as string,
        );
        if (!prismaUserId) break;
        const plan = planFromSubscriptionObject(sub);
        // Mirror status + cancel flag; if the active plan changed
        // (immediate upgrade), grant the new cycle.
        await prisma.subscription.update({
          where: { userId: prismaUserId },
          data: {
            stripeSubscriptionId: sub.id,
            stripePriceId: sub.items.data[0]?.price.id ?? null,
            cadence: cadenceFromSubscriptionObject(sub),
            status: narrowStatus(sub.status),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            currentPeriodEnd: periodEnd(sub),
            ...(plan ? { plan } : {}),
          },
        });
        if (plan) {
          await grantSubscriptionCycle({
            userId: prismaUserId,
            plan,
            periodEnd: periodEnd(sub) ?? undefined,
          });
        }
        // Cancellation scheduled - tell the user when access ends.
        if (sub.cancel_at_period_end && periodEnd(sub)) {
          await fanOutNotification({
            type: "billing.subscription_ending",
            projectId: null,
            actorPrismaUserId: null,
            recipientUserIds: [prismaUserId],
            allowSelfEcho: true,
            payload: { date: formatDate(periodEnd(sub)!) },
          }).catch(() => {});
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const prismaUserId = await prismaUserIdForCustomer(
          sub.customer as string,
        );
        if (!prismaUserId) break;
        // Downgrade to Free - remaining balance stays spendable
        // (changePlanKeepBalance only changes the NEXT allotment).
        await changePlanKeepBalance({ userId: prismaUserId, plan: "free" });
        await prisma.subscription.update({
          where: { userId: prismaUserId },
          data: {
            status: "canceled",
            plan: "free",
            stripeSubscriptionId: null,
            stripePriceId: null,
            cadence: null,
            cancelAtPeriodEnd: false,
          },
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : null;
        if (!customerId) break;
        const prismaUserId = await prismaUserIdForCustomer(customerId);
        if (!prismaUserId) break;
        await prisma.subscription
          .update({
            where: { userId: prismaUserId },
            data: { status: "past_due" },
          })
          .catch(() => {});
        await fanOutNotification({
          type: "billing.payment_failed",
          projectId: null,
          actorPrismaUserId: null,
          recipientUserIds: [prismaUserId],
          allowSelfEcho: true,
          payload: {},
        }).catch(() => {});
        break;
      }

      case "charge.refunded":
        // Manual refunds (support-initiated) clawing back granted
        // credits land with the admin panel (billing plan §9). Logged
        // only for now so the event is recorded as handled.
        console.info("[stripe] charge.refunded received", { id: event.id });
        break;

      default:
        // Unhandled event types are still claimed (so Stripe stops
        // retrying) and acknowledged.
        break;
    }
  } catch (err) {
    // A genuine handler failure: un-claim so Stripe retries, and 500.
    await prisma.stripeWebhookEvent
      .delete({ where: { id: event.id } })
      .catch(() => {});
    console.error("[stripe] webhook handler failed", {
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── helpers ────────────────────────────────────────────────────────

async function applySubscriptionGrant(
  prismaUserId: string,
  subscriptionId: string | null,
  plan: KnownPlan,
): Promise<void> {
  let end: Date | undefined;
  let priceId: string | null = null;
  let cadence: BillingCadence | null = null;
  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    end = periodEnd(sub) ?? undefined;
    priceId = sub.items.data[0]?.price.id ?? null;
    cadence = cadenceFromSubscriptionObject(sub);
  }
  await grantSubscriptionCycle({ userId: prismaUserId, plan, periodEnd: end });
  await prisma.subscription.update({
    where: { userId: prismaUserId },
    data: {
      plan,
      status: "active",
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      cadence,
      currentPeriodEnd: end ?? null,
      cancelAtPeriodEnd: false,
    },
  });
}

async function planFromSubscription(
  subscriptionId: string,
): Promise<KnownPlan | null> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return planFromSubscriptionObject(sub);
}

function planFromSubscriptionObject(
  sub: Stripe.Subscription,
): KnownPlan | null {
  const price = sub.items.data[0]?.price;
  const grant = parseGrantMetadata(
    (price?.metadata as Record<string, string>) ?? null,
  );
  if (grant?.kind === "subscription") return grant.plan;
  // Fallback: resolve via the price's lookup_key catalog entry.
  if (price?.lookup_key) {
    const spec = specByLookupKey(price.lookup_key);
    if (spec?.grant.kind === "subscription") return spec.grant.plan;
  }
  return null;
}

// The billing interval ("monthly" | "yearly"), mirrored onto the
// Subscription row so the UI can show cadence without a Stripe round-trip.
// Primary source is the price's own `recurring.interval` (always present on a
// subscription price); falls back to our grant metadata, then null.
function cadenceFromSubscriptionObject(
  sub: Stripe.Subscription,
): BillingCadence | null {
  const price = sub.items.data[0]?.price;
  const interval = price?.recurring?.interval;
  if (interval === "month") return "monthly";
  if (interval === "year") return "yearly";
  const grant = parseGrantMetadata(
    (price?.metadata as Record<string, string>) ?? null,
  );
  if (grant?.kind === "subscription") return grant.cadence;
  return null;
}

function narrowStatus(s: Stripe.Subscription.Status): string {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  return "canceled";
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items.data[0];
  const ts = item?.current_period_end ?? null;
  return ts ? new Date(ts * 1000) : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const line = invoice.lines.data.find((l) => l.subscription);
  const s = line?.subscription;
  return typeof s === "string" ? s : (s?.id ?? null);
}

function formatDate(d: Date): string {
  // Latin-digit "D Month" (brand rule). Locale-agnostic; the dict copy
  // wraps it.
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long" });
}
