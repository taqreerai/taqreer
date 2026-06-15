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
import { renderEmail, summaryBlock } from "./shell";

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

// Billing emails go from a dedicated billing@ address (user direction
// 2026-06-15), distinct from the shared RESEND_FROM_EMAIL (share@) the other
// transactional emails use. Override via RESEND_FROM_BILLING if needed.
const BILLING_FROM =
  process.env.RESEND_FROM_BILLING ?? "taqreer.ai <billing@taqreer.ai>";

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

type Common = { toEmail: string; locale: string; appOrigin: string };

// ─── 1. Receipt / payment succeeded ───────────────────────────────────

const RECEIPT_COPY = {
  ar: {
    subject: "إيصال الدفع - taqreer.ai",
    preheader: "تم استلام دفعتك، وهذا إيصالك.",
    title: "تم استلام دفعتك",
    sub: "شكرًا لك. تمت معالجة دفعتك بنجاح، وهذا إيصالك. نسخة منه متوفرة دائمًا في سجل الفواتير.",
    rows: {
      plan: "الخطة",
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
    { label: c.rows.plan, value: input.planLabel },
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

// ─── 2. Payment failed (dunning) ──────────────────────────────────────

const FAILED_COPY = {
  ar: {
    subject: "تعذّر إتمام الدفع - taqreer.ai",
    preheader: "لم نتمكن من إتمام الدفع، حدّث بطاقتك للاستمرار.",
    title: "تعذّر إتمام الدفع",
    sub: "لم نتمكن من سحب المبلغ من بطاقتك لاشتراكك في taqreer.ai. حدّث وسيلة الدفع للحفاظ على خطتك، وسنحاول تلقائيًا مرة أخرى.",
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
    subject: "اشتراكك في taqreer.ai ينتهي قريبًا",
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
