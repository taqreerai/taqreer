// Billing transactional emails (Resend) — receipt, payment-failed, and
// subscription-ending. All three ride the shared production shell
// (lib/email/shell: our icon, flat dark canvas, blue button) + summaryBlock for
// the receipt-style key/value rows. Locale-aware at SEND time (one language per
// email, chosen from the recipient's saved locale) — same pattern as
// send-welcome, NOT the Supabase dual-language template.
//
// Graceful: stubs (logs + returns ok) when Resend env is absent so dev/webhook
// paths never break, and every sender is fire-and-forget at the call site.
//
// Latin numerals only in user-facing copy (brand rule); the caller formats
// amounts/dates as strings.

import { Resend } from "resend";
import { renderEmail, summaryBlock, ltrIsolate } from "./shell";

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export type SendResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

// All automated emails send from noreply@ (user direction 2026-07-14) - the
// shared RESEND_FROM_EMAIL and this billing default now both use noreply@ (the
// old share@ / billing@ senders are retired). Override via RESEND_FROM_BILLING
// only if a dedicated, real billing sender is ever reinstated.
const BILLING_FROM =
  process.env.RESEND_FROM_BILLING ?? "taqreer.ai <noreply@taqreer.ai>";

async function deliver(
  tag: string,
  toEmail: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  const client = getClient();
  if (!client) {
    console.info(`[${tag}] Resend not configured — stubbed send`);
    return { ok: true, provider: "stub" };
  }
  try {
    const res = await client.emails.send({
      from: BILLING_FROM,
      to: toEmail,
      subject,
      html,
    });
    if (res.error) {
      console.error(`[${tag}] Resend send error:`, res.error.message);
      return { ok: false, error: res.error.message };
    }
    // Success log (billing observability): every send is traceable, with the
    // Resend messageId to cross-reference deliverability in the dashboard.
    console.info(`[${tag}] sent (messageId ${res.data?.id ?? "?"})`);
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[${tag}] send threw:`, message);
    return { ok: false, error: message };
  }
}

function langOf(locale: string): "ar" | "en" {
  return locale === "en" ? "en" : "ar";
}
const dirOf = (lang: "ar" | "en") => (lang === "ar" ? "rtl" : "ltr");

const SUPPORT_LINK =
  '<a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>';

// Brand pre-isolated so it keeps LTR order inside the Arabic copy (Outlook bidi).
const BR = ltrIsolate("taqreer.ai");

type Common = { toEmail: string; locale: string; appOrigin: string };

// ─── 1. Receipt / payment succeeded ───────────────────────────────────

const RECEIPT_COPY = {
  ar: {
    subject: `إيصال الدفع - ${BR}`,
    preheader: "تم استلام دفعتك، وهذا إيصالك.",
    title: "تم استلام دفعتك",
    sub: "شكرًا لك. تمت معالجة دفعتك بنجاح، وهذا إيصالك. نسخة منه متوفرة دائمًا في سجل الفواتير.",
    rows: {
      plan: "الخطة",
      pack: "الباقة",
      amount: "المبلغ المدفوع",
      date: "التاريخ",
      invoice: "رقم الفاتورة",
      period: "فترة الاشتراك",
    },
    button: "عرض الفاتورة كاملة",
    footer: `لأي استفسار حول فاتورتك، تواصل معنا على ${SUPPORT_LINK}.`,
  },
  en: {
    subject: "Your taqreer.ai receipt",
    preheader: "Payment received - here is your receipt.",
    title: "Payment received",
    sub: "Thanks. Your payment went through, and here is your receipt. A copy is always available in your billing history.",
    rows: {
      plan: "Plan",
      pack: "Pack",
      amount: "Amount paid",
      date: "Date",
      invoice: "Invoice",
      period: "Billing period",
    },
    button: "View full invoice",
    footer: `Questions about your bill? Reach us at ${SUPPORT_LINK}.`,
  },
} as const;

export async function sendReceipt(
  input: Common & {
    // "pack" = a one-time top-up (not a plan); labels the first row.
    itemKind?: "plan" | "pack";
    planLabel: string;
    amount: string;
    dateLabel: string;
    invoiceNumber: string | null;
    periodLabel: string | null;
    invoiceUrl: string | null;
  },
): Promise<SendResult> {
  const lang = langOf(input.locale);
  const c = RECEIPT_COPY[lang];
  const rows: { label: string; value: string }[] = [
    {
      label: input.itemKind === "pack" ? c.rows.pack : c.rows.plan,
      value: input.planLabel,
    },
    { label: c.rows.amount, value: input.amount },
    { label: c.rows.date, value: input.dateLabel },
  ];
  if (input.invoiceNumber)
    rows.push({ label: c.rows.invoice, value: input.invoiceNumber });
  if (input.periodLabel)
    rows.push({ label: c.rows.period, value: input.periodLabel });

  const html = renderEmail({
    lang,
    preheader: c.preheader,
    title: c.title,
    subHtml: c.sub,
    extraHtml: summaryBlock(rows, dirOf(lang)),
    buttonLabel: c.button,
    buttonHref: input.invoiceUrl ?? `${input.appOrigin}/${lang}/invoices`,
    footerNoteHtml: c.footer,
  });
  return deliver("receipt", input.toEmail, c.subject, html);
}

// ─── 1b. Credit refund (goodwill / cancelled generation) ──────────────

const REFUND_COPY = {
  ar: {
    subject: `تمت إعادة نقاط إلى رصيدك - ${BR}`,
    preheader: "أعدنا بعض النقاط إلى رصيدك.",
    title: "أعدنا نقاطك",
    subCancelled: `لاحظنا أنك أوقفت إنشاء عرضك قبل اكتماله، فأعدنا رسوم الإعداد إلى رصيدك. تدفع فقط مقابل الشرائح التي احتفظت بها. رصيدك الجديد جاهز للاستخدام في ${BR}.`,
    subGoodwill: `أضفنا نقاطًا إلى رصيدك كتسوية من فريق ${BR}. رصيدك الجديد جاهز للاستخدام مباشرة.`,
    rows: { credits: "النقاط المعادة", balance: "رصيدك الآن", date: "التاريخ" },
    button: "افتح لوحة التحكم",
    footer: `لأي استفسار حول رصيدك، تواصل معنا على ${SUPPORT_LINK}.`,
  },
  en: {
    subject: `Credits refunded to your balance - ${BR}`,
    preheader: "We returned some credits to your balance.",
    title: "We refunded your credits",
    subCancelled: `We noticed you stopped your deck before it finished, so we returned the setup fee to your balance. You only pay for the slides you kept. Your new balance is ready to use on ${BR}.`,
    subGoodwill: `We added credits to your balance as a goodwill adjustment from the ${BR} team. Your new balance is ready to use right away.`,
    rows: { credits: "Credits refunded", balance: "Your balance now", date: "Date" },
    button: "Open your dashboard",
    footer: `Questions about your balance? Reach us at ${SUPPORT_LINK}.`,
  },
} as const;

type RefundInput = Common & {
  credits: string;
  reason: "cancelled" | "goodwill";
  dateLabel: string;
  balanceLabel: string | null;
};

// Render only (no send) - shared by sendRefund and the design-preview
// harness so the previewed email is byte-identical to the sent one.
export function renderRefundEmail(input: RefundInput): {
  subject: string;
  html: string;
} {
  const lang = langOf(input.locale);
  const c = REFUND_COPY[lang];
  const rows: { label: string; value: string }[] = [
    { label: c.rows.credits, value: input.credits },
  ];
  if (input.balanceLabel)
    rows.push({ label: c.rows.balance, value: input.balanceLabel });
  rows.push({ label: c.rows.date, value: input.dateLabel });

  const html = renderEmail({
    lang,
    preheader: c.preheader,
    title: c.title,
    subHtml: input.reason === "cancelled" ? c.subCancelled : c.subGoodwill,
    extraHtml: summaryBlock(rows, dirOf(lang)),
    buttonLabel: c.button,
    buttonHref: `${input.appOrigin}/${lang}/dashboard`,
    footerNoteHtml: c.footer,
  });
  return { subject: c.subject, html };
}

export async function sendRefund(input: RefundInput): Promise<SendResult> {
  const { subject, html } = renderRefundEmail(input);
  return deliver("refund", input.toEmail, subject, html);
}

// ─── 2. Payment failed (dunning) ──────────────────────────────────────

const FAILED_COPY = {
  ar: {
    subject: `تعذّر إتمام الدفع - ${BR}`,
    preheader: "لم نتمكن من إتمام الدفع، حدّث بطاقتك للاستمرار.",
    title: "تعذّر إتمام الدفع",
    sub: `لم نتمكن من سحب المبلغ من بطاقتك لاشتراكك في ${BR}. حدّث وسيلة الدفع للحفاظ على خطتك، وسنحاول تلقائيًا مرة أخرى.`,
    rows: { plan: "الخطة", amount: "المبلغ المستحق" },
    button: "تحديث وسيلة الدفع",
    footer: `إذا كنت قد حدّثت بطاقتك بالفعل، يمكنك تجاهل هذه الرسالة. للمساعدة: ${SUPPORT_LINK}.`,
  },
  en: {
    subject: "Your taqreer.ai payment failed",
    preheader: "We could not process your payment - update your card to keep your plan.",
    title: "Your payment didn't go through",
    sub: "We couldn't charge your card for your taqreer.ai subscription. Update your payment method to keep your plan active - we'll try again automatically.",
    rows: { plan: "Plan", amount: "Amount due" },
    button: "Update payment method",
    footer: `Already updated your card? You can ignore this. Need help? ${SUPPORT_LINK}.`,
  },
} as const;

export async function sendPaymentFailed(
  input: Common & { planLabel: string; amount: string },
): Promise<SendResult> {
  const lang = langOf(input.locale);
  const c = FAILED_COPY[lang];
  const html = renderEmail({
    lang,
    preheader: c.preheader,
    title: c.title,
    subHtml: c.sub,
    extraHtml: summaryBlock(
      [
        { label: c.rows.plan, value: input.planLabel },
        { label: c.rows.amount, value: input.amount },
      ],
      dirOf(lang),
    ),
    buttonLabel: c.button,
    buttonHref: `${input.appOrigin}/${lang}/billing`,
    footerNoteHtml: c.footer,
  });
  return deliver("payment-failed", input.toEmail, c.subject, html);
}

// ─── 3. Subscription ending (cancel scheduled) ────────────────────────

const ENDING_COPY = {
  ar: {
    subject: `اشتراكك في ${BR} ينتهي قريبًا`,
    preheader: "تنتهي خطتك قريبًا، ويمكنك الاستئناف في أي وقت.",
    title: "اشتراكك على وشك الانتهاء",
    sub: "تمت جدولة انتهاء اشتراكك. ستحتفظ بكامل صلاحياتك حتى التاريخ الموضّح أدناه. غيّرت رأيك؟ يمكنك استئناف الاشتراك في أي وقت.",
    rows: { plan: "الخطة", until: "متاح حتى" },
    button: "إدارة الاشتراك",
    footer: `سيظل رصيدك المتبقي متاحًا حتى نهاية الفترة. لأي مساعدة: ${SUPPORT_LINK}.`,
  },
  en: {
    subject: "Your taqreer.ai subscription is ending",
    preheader: "Your plan ends soon - you can resume anytime.",
    title: "Your subscription is ending",
    sub: "Your subscription is set to end. You'll keep full access until the date below. Changed your mind? You can resume anytime.",
    rows: { plan: "Plan", until: "Access until" },
    button: "Manage subscription",
    footer: `Your remaining credits stay available until the period ends. Need a hand? ${SUPPORT_LINK}.`,
  },
} as const;

export async function sendSubscriptionEnding(
  input: Common & { planLabel: string; endDateLabel: string },
): Promise<SendResult> {
  const lang = langOf(input.locale);
  const c = ENDING_COPY[lang];
  const html = renderEmail({
    lang,
    preheader: c.preheader,
    title: c.title,
    subHtml: c.sub,
    extraHtml: summaryBlock(
      [
        { label: c.rows.plan, value: input.planLabel },
        { label: c.rows.until, value: input.endDateLabel },
      ],
      dirOf(lang),
    ),
    buttonLabel: c.button,
    buttonHref: `${input.appOrigin}/${lang}/billing`,
    footerNoteHtml: c.footer,
  });
  return deliver("subscription-ending", input.toEmail, c.subject, html);
}
