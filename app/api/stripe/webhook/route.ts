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

import { recordDeckPurchase, refundDeckPurchase } from "@/lib/billing/deck-unlock";
import { rewardInviterOnFirstPayment } from "@/lib/referral";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
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
import {
  emailReceiptForInvoice,
  emailReceiptForTopup,
  emailPaymentFailed,
  emailSubscriptionEnding,
} from "@/lib/billing/receipt-email";
import { broadcastToUser } from "@/lib/realtime/server-broadcast";
import { revalidatePricingSurfaces } from "@/lib/config/revalidate-surfaces";
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

        if (grant.kind === "deck_unlock") {
          // One-time unlock of ONE deck (2026-10-08): record it, drop the
          // deck's watermark and start the comped unlock (idempotent on the
          // session id; the deck must be the buyer's).
          const projectId =
            (session.metadata as Record<string, string>)?.projectId ?? null;
          if (projectId) {
            const res = await recordDeckPurchase({
              prismaUserId,
              projectId,
              bracket: grant.bracket,
              sessionId: session.id,
              paymentStatus: session.payment_status ?? null,
              paymentIntentId:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id ?? null,
              amountCents: session.amount_total ?? null,
              currency: session.currency ?? null,
            });
            if (!res.recorded) {
              console.error("[stripe] deck purchase not recorded", {
                sessionId: session.id,
                reason: res.reason,
              });
            }
          }
        } else if (grant.kind === "topup") {
          const result = await grantTopup({
            userId: prismaUserId,
            credits: grant.credits,
            // Idempotency anchor: the Checkout Session id is one-time.
            sourceKey: session.id,
          });
          if (result.granted > 0) {
            await notifyCredited(prismaUserId, grant.credits, "topup");
            await emailReceiptForTopup(
              prismaUserId,
              session,
              grant.credits,
            ).catch((err) =>
              console.error(
                "[stripe] top-up receipt email failed:",
                err instanceof Error ? err.message : String(err),
              ),
            );
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
          // Invite-a-colleague: the buyer's first paid subscription rewards
          // whoever invited them (idempotent, capped; lib/referral.ts). Never
          // fails the webhook.
          await rewardInviterOnFirstPayment(prismaUserId).catch((err) =>
            console.error(
              "[stripe] referral reward failed:",
              err instanceof Error ? err.message : String(err),
            ),
          );
          // Purchase/upgrade activation - tell the user (renewals are
          // covered by invoice.payment_succeeded's "credited" path;
          // this session-scoped emit fires once per checkout).
          const { ensureFresh, getTier } = await import(
            "@/lib/config/runtime-config"
          );
          await ensureFresh();
          await fanOutNotification({
            type: "billing.plan_changed",
            projectId: null,
            actorPrismaUserId: null,
            recipientUserIds: [prismaUserId],
            allowSelfEcho: true,
            payload: {
              plan: grant.plan,
              credits: getTier(grant.plan).monthlyAllotment,
            },
          }).catch(() => {});
        }

        // Conversion-funnel step 4/4: a completed purchase (new subscription or
        // top-up pack). distinctId MUST be the Supabase uid to match the client
        // posthog.identify(); the webhook only has the Prisma id, so look it up.
        const buyer = await prisma.user.findUnique({
          where: { id: prismaUserId },
          select: { supabaseUserId: true },
        });
        if (buyer?.supabaseUserId) {
          captureServerEvent(buyer.supabaseUserId, "purchase_completed", {
            kind: grant.kind,
            plan: grant.kind === "subscription" ? grant.plan : undefined,
            cadence: grant.kind === "subscription" ? grant.cadence : undefined,
            credits: grant.kind === "topup" ? grant.credits : undefined,
            bracket: grant.kind === "deck_unlock" ? grant.bracket : undefined,
            amount:
              session.amount_total != null
                ? session.amount_total / 100
                : undefined,
            currency: session.currency ?? undefined,
          });
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        // A delayed payment method confirmed after checkout completed (the
        // completed event arrived with payment_status "unpaid"). Only deck
        // unlocks need it today: record + unlock once the money is in.
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = (session.metadata ?? {}) as Record<string, string>;
        const grant = parseGrantMetadata(meta);
        if (grant?.kind === "deck_unlock" && meta.prismaUserId && meta.projectId) {
          await recordDeckPurchase({
            prismaUserId: meta.prismaUserId,
            projectId: meta.projectId,
            bracket: grant.bracket,
            sessionId: session.id,
            paymentStatus: session.payment_status ?? null,
            paymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id ?? null,
            amountCents: session.amount_total ?? null,
            currency: session.currency ?? null,
          });
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
          const { ensureFresh, getTier } = await import(
            "@/lib/config/runtime-config"
          );
          await ensureFresh();
          await notifyCredited(
            prismaUserId,
            getTier(plan).monthlyAllotment,
            "renewal",
          );
        }
        // Branded receipt (our design), for the initial payment + every
        // renewal. Caught so a mail hiccup never fails the webhook.
        await emailReceiptForInvoice(prismaUserId, invoice, plan).catch((err) =>
          console.error(
            "[stripe] receipt email failed:",
            err instanceof Error ? err.message : String(err),
          ),
        );
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const prismaUserId = await prismaUserIdForCustomer(
          sub.customer as string,
        );
        if (!prismaUserId) break;
        const plan = planFromSubscriptionObject(sub);
        // Read the CURRENTLY stored plan BEFORE mirroring, so we can tell a
        // real mid-cycle plan change (upgrade) apart from a cancel / payment-
        // method / flag edit. This event fires on ALL of those, but only an
        // actual plan change may re-grant: grantSubscriptionCycle SETS the
        // balance to the full allotment, so re-granting on a cancel refilled
        // every credit the user had already spent (the cancel-refills
        // exploit). First grant: checkout.session.completed. Renewals:
        // invoice.payment_succeeded.
        const before = await prisma.subscription.findUnique({
          where: { userId: prismaUserId },
          select: { plan: true },
        });
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
        // Mirror changed (cancel/resume/plan/status) → nudge open billing tabs.
        await broadcastToUser(prismaUserId, "subscription.changed", {}).catch(
          () => {},
        );
        if (plan && plan !== before?.plan) {
          await grantSubscriptionCycle({
            userId: prismaUserId,
            plan,
            periodEnd: periodEnd(sub) ?? undefined,
          });
        }
        // Cancellation just SCHEDULED (false -> true transition only) - notify
        // + email once. Detect the transition from Stripe's previous_attributes
        // (the fields that changed in THIS event), NOT our DB `before`: the
        // cancel route mirrors cancelAtPeriodEnd into the DB synchronously (the
        // "cancel button stayed" UX fix), so by the time this webhook runs the
        // DB row is already true and a DB-based false->true check never fires -
        // which is why the cancellation email silently stopped sending. Using
        // previous_attributes also keeps it to once: a later update while still
        // cancel_at_period_end won't list the flag as changed.
        const prevAttrs = event.data.previous_attributes as
          | Partial<Stripe.Subscription>
          | undefined;
        if (
          sub.cancel_at_period_end &&
          prevAttrs?.cancel_at_period_end === false &&
          periodEnd(sub)
        ) {
          await fanOutNotification({
            type: "billing.subscription_ending",
            projectId: null,
            actorPrismaUserId: null,
            recipientUserIds: [prismaUserId],
            allowSelfEcho: true,
            payload: { date: formatDate(periodEnd(sub)!) },
          }).catch(() => {});
          // Branded "subscription ending" email.
          await emailSubscriptionEnding(
            prismaUserId,
            plan,
            cadenceFromSubscriptionObject(sub),
            periodEnd(sub)!,
          ).catch((err) =>
            console.error(
              "[stripe] subscription-ending email failed:",
              err instanceof Error ? err.message : String(err),
            ),
          );
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
        await broadcastToUser(prismaUserId, "subscription.changed", {}).catch(
          () => {},
        );
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
        // Dunning: status flipped to past_due → refresh the banner in place.
        await broadcastToUser(prismaUserId, "subscription.changed", {}).catch(
          () => {},
        );
        await fanOutNotification({
          type: "billing.payment_failed",
          projectId: null,
          actorPrismaUserId: null,
          recipientUserIds: [prismaUserId],
          allowSelfEcho: true,
          payload: {},
        }).catch(() => {});
        // Branded payment-failed email (update-your-card).
        const failedSubId = invoiceSubscriptionId(invoice);
        const failedPlan = failedSubId
          ? await planFromSubscription(failedSubId)
          : null;
        await emailPaymentFailed(prismaUserId, invoice, failedPlan).catch(
          (err) =>
            console.error(
              "[stripe] payment-failed email failed:",
              err instanceof Error ? err.message : String(err),
            ),
        );
        break;
      }

      case "charge.refunded": {
        // A refunded one-time deck unlock: the deck's watermark returns (the
        // unlocked slides stay). Credit claw-backs for top-ups / plans land
        // with the admin panel (billing plan §9); logged only.
        const charge = event.data.object as Stripe.Charge;
        const pi =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (pi && charge.refunded) await refundDeckPurchase(pi);
        console.info("[stripe] charge.refunded received", { id: event.id });
        break;
      }

      case "price.created":
      case "price.updated":
      case "price.deleted":
      case "product.updated":
        // A tier Price changed in Stripe (possibly out-of-band of a deploy):
        // refresh the force-static pricing surfaces so the cards never advertise
        // a price we no longer charge. Best-effort - a purge blip must not 500
        // the webhook (Stripe would retry forever). Checkout resolves Prices live.
        await revalidatePricingSurfaces().catch((e) =>
          console.error("[stripe] pricing revalidate failed", e),
        );
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
  await broadcastToUser(prismaUserId, "subscription.changed", {}).catch(() => {});
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
  // Stripe intervals are day|week|month|year, but BILLING_CATALOG only ever
  // mints month + year prices, so day/week never reach here. If one somehow
  // did (a manually-created price), we fall through to grant metadata, then
  // null - the UI just omits the cadence pill rather than mislabelling.
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
  // Stripe API 2026-04-22.dahlia removed the top-level `invoice.subscription`
  // and `line.subscription` fields and moved the reference into `parent`
  // details. Read the new locations first, then fall back to the legacy fields
  // so this stays correct across API versions. (Returning null here previously
  // made invoice.payment_succeeded break before the grant + receipt: the
  // initial balance still filled via checkout.session.completed, but the
  // receipt never sent and renewals never re-granted.)
  const pick = (
    s: string | { id?: string } | null | undefined,
  ): string | null => (typeof s === "string" ? s : (s?.id ?? null));

  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: {
      subscription_details?: {
        subscription?: string | { id?: string } | null;
      } | null;
    } | null;
    lines: {
      data: Array<{
        subscription?: string | { id?: string } | null;
        parent?: {
          subscription_item_details?: {
            subscription?: string | { id?: string } | null;
          } | null;
        } | null;
      }>;
    };
  };

  const fromInvoiceParent = pick(inv.parent?.subscription_details?.subscription);
  if (fromInvoiceParent) return fromInvoiceParent;
  for (const l of inv.lines.data) {
    const fromLineParent = pick(
      l.parent?.subscription_item_details?.subscription,
    );
    if (fromLineParent) return fromLineParent;
    const fromLine = pick(l.subscription);
    if (fromLine) return fromLine;
  }
  return pick(inv.subscription);
}

function formatDate(d: Date): string {
  // Latin-digit "D Month" (brand rule). Locale-agnostic; the dict copy
  // wraps it.
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long" });
}
