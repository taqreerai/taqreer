// Bridges Stripe webhook events to our branded billing emails
// (lib/email/billing). Each trigger fetches the recipient's email + saved
// locale (User.language), formats the figures in their language with Latin
// numerals (brand rule), and sends. Server-only; the webhook calls these
// fire-and-forget so a mail hiccup never fails the handler.

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/billing/stripe";
import type { KnownPlan } from "@/lib/plan";
import {
  sendReceipt,
  sendPaymentFailed,
  sendSubscriptionEnding,
  sendRefund,
} from "@/lib/email/billing";

const APP_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai";

type Cadence = "monthly" | "yearly" | null;

async function recipient(
  prismaUserId: string,
): Promise<{ email: string; locale: string } | null> {
  const u = await prisma.user.findUnique({
    where: { id: prismaUserId },
    select: { email: true, language: true },
  });
  if (!u?.email) {
    // Silent skip otherwise: surface it so a missing recipient is traceable
    // (e.g. a webhook firing before User.email is populated).
    console.warn(`[billing-email] no recipient email for user ${prismaUserId}`);
    return null;
  }
  return { email: u.email, locale: u.language ?? "ar" };
}

// Latin-numeral currency (brand rule): en-US digits, the real currency symbol.
function money(minor: number | null | undefined, currency: string | null | undefined): string {
  const amount = (minor ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "usd").toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${(currency ?? "").toUpperCase()}`.trim();
  }
}

// "15 June 2026" (en) / "15 يونيو 2026" (ar) — Latin digits in both.
function dateLabel(unixSeconds: number, locale: string): string {
  const loc = locale === "ar" ? "ar-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(loc, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(unixSeconds * 1000));
}

function planLabel(plan: KnownPlan | null, cadence: Cadence, locale: string): string {
  if (!plan) return locale === "ar" ? "الاشتراك" : "Subscription";
  const tier = plan.charAt(0).toUpperCase() + plan.slice(1); // Plus / Pro / Max
  if (!cadence) return tier;
  const word =
    locale === "ar"
      ? cadence === "yearly"
        ? "سنوي"
        : "شهري"
      : cadence === "yearly"
        ? "yearly"
        : "monthly";
  return `${tier} (${word})`;
}

// The billing interval ("monthly"/"yearly") for the receipt's plan label.
// Read from our own Subscription row (mirrored off the subscription price by
// applySubscriptionGrant, which runs before the receipt fires) rather than the
// invoice: Stripe API 2026-04-22.dahlia dropped `line.price`, so the interval
// is no longer present on the invoice line.
async function cadenceForUser(prismaUserId: string): Promise<Cadence> {
  const s = await prisma.subscription.findUnique({
    where: { userId: prismaUserId },
    select: { cadence: true },
  });
  return (s?.cadence as Cadence) ?? null;
}

export async function emailReceiptForInvoice(
  prismaUserId: string,
  invoice: Stripe.Invoice,
  plan: KnownPlan,
): Promise<void> {
  const to = await recipient(prismaUserId);
  if (!to) return;
  const line = invoice.lines.data[0];
  const start = line?.period?.start;
  const end = line?.period?.end;
  const periodLabel =
    start && end
      ? `${dateLabel(start, to.locale)} - ${dateLabel(end, to.locale)}`
      : null;
  await sendReceipt({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    planLabel: planLabel(plan, await cadenceForUser(prismaUserId), to.locale),
    amount: money(invoice.amount_paid, invoice.currency),
    dateLabel: dateLabel(invoice.created, to.locale),
    invoiceNumber: invoice.number ?? null,
    periodLabel,
    invoiceUrl: invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null,
  });
}

export async function emailReceiptForTopup(
  prismaUserId: string,
  session: Stripe.Checkout.Session,
  credits: number,
): Promise<void> {
  const to = await recipient(prismaUserId);
  if (!to) return;
  const creditsStr = credits.toLocaleString("en-US");
  const invoice = await topupInvoice(session);
  await sendReceipt({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    itemKind: "pack",
    planLabel:
      to.locale === "ar"
        ? `شحن رصيد - ${creditsStr} رصيد`
        : `Credit top-up - ${creditsStr} credits`,
    amount: money(session.amount_total, session.currency),
    dateLabel: dateLabel(
      session.created ?? Math.floor(Date.now() / 1000),
      to.locale,
    ),
    invoiceNumber: invoice?.number ?? null,
    periodLabel: null,
    // The post-payment invoice (checkout invoice_creation). Without one (a
    // session from before invoicing was enabled) the sender falls back to
    // /invoices.
    invoiceUrl: invoice?.hosted_invoice_url ?? invoice?.invoice_pdf ?? null,
  });
}

// The top-up's post-payment invoice, when the session created one. Soft-fails
// to null so a Stripe hiccup still sends the receipt (without the link).
async function topupInvoice(
  session: Stripe.Checkout.Session,
): Promise<Stripe.Invoice | null> {
  const ref = session.invoice;
  if (!ref) return null;
  if (typeof ref !== "string") return ref;
  try {
    return await stripe.invoices.retrieve(ref);
  } catch (err) {
    console.error(
      "[billing-email] top-up invoice lookup failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function emailPaymentFailed(
  prismaUserId: string,
  invoice: Stripe.Invoice,
  plan: KnownPlan | null,
): Promise<void> {
  const to = await recipient(prismaUserId);
  if (!to) return;
  await sendPaymentFailed({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    planLabel: planLabel(plan, await cadenceForUser(prismaUserId), to.locale),
    amount: money(invoice.amount_due ?? invoice.amount_paid, invoice.currency),
  });
}

// Credit REFUND (goodwill / user-cancelled generation) - not a Stripe money
// refund; the account's credit balance was topped back up. Latin-numeral
// credit counts (brand rule). Fire-and-forget at the call site.
export async function emailRefundCredits(
  prismaUserId: string,
  input: {
    credits: number;
    reason: "cancelled" | "goodwill";
    balance: number | null;
    now?: Date;
  },
): Promise<void> {
  const to = await recipient(prismaUserId);
  if (!to) return;
  const n = (v: number) => v.toLocaleString("en-US");
  await sendRefund({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    credits: n(input.credits),
    reason: input.reason,
    balanceLabel: input.balance != null ? n(input.balance) : null,
    dateLabel: dateLabel(
      Math.floor((input.now ?? new Date()).getTime() / 1000),
      to.locale,
    ),
  });
}

export async function emailSubscriptionEnding(
  prismaUserId: string,
  plan: KnownPlan | null,
  cadence: Cadence,
  periodEnd: Date,
): Promise<void> {
  const to = await recipient(prismaUserId);
  if (!to) return;
  await sendSubscriptionEnding({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    planLabel: planLabel(plan, cadence, to.locale),
    endDateLabel: dateLabel(Math.floor(periodEnd.getTime() / 1000), to.locale),
  });
}
