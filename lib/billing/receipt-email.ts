// Bridges Stripe webhook events to our branded billing emails
// (lib/email/billing). Each trigger fetches the recipient's email + saved
// locale (User.language), formats the figures in their language with Latin
// numerals (brand rule), and sends. Server-only; the webhook calls these
// fire-and-forget so a mail hiccup never fails the handler.

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { KnownPlan } from "@/lib/plan";
import {
  sendReceipt,
  sendPaymentFailed,
  sendSubscriptionEnding,
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
  if (!u?.email) return null;
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

// The billing interval off the invoice's first line. Cast to a minimal shape
// so we don't depend on Stripe's evolving InvoiceLineItem.price typing.
function cadenceFromInvoice(invoice: Stripe.Invoice): Cadence {
  const line = invoice.lines.data[0] as
    | { price?: { recurring?: { interval?: string } | null } | null }
    | undefined;
  const interval = line?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : interval === "month" ? "monthly" : null;
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
    planLabel: planLabel(plan, cadenceFromInvoice(invoice), to.locale),
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
  await sendReceipt({
    toEmail: to.email,
    locale: to.locale,
    appOrigin: APP_ORIGIN,
    planLabel:
      to.locale === "ar"
        ? `شحن رصيد - ${creditsStr} رصيد`
        : `Credit top-up - ${creditsStr} credits`,
    amount: money(session.amount_total, session.currency),
    dateLabel: dateLabel(
      session.created ?? Math.floor(Date.now() / 1000),
      to.locale,
    ),
    invoiceNumber: null,
    periodLabel: null,
    invoiceUrl: null, // top-ups have no hosted invoice; sender links /invoices
  });
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
    planLabel: planLabel(plan, cadenceFromInvoice(invoice), to.locale),
    amount: money(invoice.amount_due ?? invoice.amount_paid, invoice.currency),
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
