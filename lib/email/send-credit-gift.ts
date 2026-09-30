// Credit-gift email - sent when an admin grants bonus credits and opts to
// notify the recipients (the admin Users panel checkbox). Same shell +
// structure as the welcome email (pill, title, CTA, templates strip), gift
// wording. Locale-aware per User.language.
//
// Same graceful pattern as send-welcome: stubs (logs + returns ok) when
// Resend env is absent so local grants don't break, never throws.

import { Resend } from "resend";
import { renderEmail, templatesStrip, ltrIsolate, escapeHtml } from "./shell";
import {
  getWelcomeTemplates,
  type WelcomeTemplate,
} from "@/lib/auth/marquee-projects";

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

// Brand pre-isolated so it keeps LTR order inside the Arabic copy (Outlook bidi).
const BR = ltrIsolate("taqreer.ai");

// Latin numerals only, even inside the Arabic copy; en-US grouping so large
// grants read "8,000", not "8000".
const fmt = (n: number) => n.toLocaleString("en-US");

const COPY = {
  ar: {
    // Subject + title wording approved by Osama 2026-07-07.
    subject: `هدية من ${BR} - رصيد إضافي في حسابك`,
    preheader: (n: number) => `أضفنا ${fmt(n)} رصيد إضافي مجاني إلى حسابك.`,
    credits: (n: number) => `${fmt(n)} رصيد إضافي مضاف لحسابك`,
    title: `أضفنا رصيدا إضافيا إلى حسابك`,
    sub: `شكرا لكونك من أوائل مستخدمي ${BR}. أضفنا رصيدا مجانيا إضافيا إلى حسابك، وعرضك القادم علينا. الرصيد جاهز في حسابك الآن.`,
    button: "ابدأ الإنشاء",
    templatesLabel: "أو ابدأ من قالب جاهز",
    footerNote:
      'وصلك هذا البريد لأن رصيدا أضيف إلى حسابك. لأي مساعدة، تواصل معنا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.',
  },
  en: {
    subject: "A little gift from taqreer.ai: free credits added",
    preheader: (n: number) => `${fmt(n)} bonus credits were added to your account.`,
    credits: (n: number) => `${fmt(n)} bonus credits added`,
    title: "A little gift from taqreer.ai",
    sub: "Thanks for being one of our earliest users. We just added bonus credits to your account - your next presentation is on us. They're ready whenever you are.",
    button: "Start creating",
    templatesLabel: "Or start from a ready-made template",
    footerNote:
      'You received this because credits were added to your account. Need a hand? Reach us at <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.',
  },
} as const;

// Same pill as the welcome email.
function creditsPill(label: string): string {
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
                  <tr><td style="background:#16233a;border:1px solid rgba(51,128,255,0.30);border-radius:999px;padding:6px 15px;font-size:12px;font-weight:600;color:#66A3FF;">${label}</td></tr>
                </table>`;
}

export type SendCreditGiftInput = {
  toEmail: string;
  locale: string;
  appOrigin: string;
  templates: WelcomeTemplate[];
  // The credit amount actually granted.
  credits: number;
  // Admin-entered why (the grant modal's Reason field). When present it
  // REPLACES the hardcoded "earliest users" paragraph - that copy was
  // written for the original appreciation campaign and reads wrong on
  // e.g. a goodwill grant. Plain text; escaped before it enters HTML.
  reason?: string;
};

export type SendCreditGiftResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

export async function sendCreditGift(
  input: SendCreditGiftInput,
): Promise<SendCreditGiftResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  const client = getClient();
  const lang: "ar" | "en" = input.locale === "en" ? "en" : "ar";
  const c = COPY[lang];

  if (!client || !from) {
    console.info("[credit-gift] Resend not configured - stubbed send", lang);
    return { ok: true, provider: "stub" };
  }

  const tstrip = templatesStrip(
    input.templates.map((t) => ({
      href: `${input.appOrigin}/${lang}/templates`,
      src: t.cover,
    })),
    c.templatesLabel,
  );

  const reason = input.reason?.trim();
  const html = renderEmail({
    lang,
    preheader: c.preheader(input.credits),
    eyebrowHtml: creditsPill(c.credits(input.credits)),
    title: c.title,
    subHtml: reason ? escapeHtml(reason) : c.sub,
    buttonLabel: c.button,
    buttonHref: `${input.appOrigin}/${lang}/dashboard`,
    extraHtml: tstrip,
    footerNoteHtml: c.footerNote,
  });

  try {
    const res = await client.emails.send({
      from,
      to: input.toEmail,
      subject: c.subject,
      html,
    });
    if (res.error) {
      console.error("[credit-gift] Resend send error:", res.error.message);
      return { ok: false, error: res.error.message };
    }
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[credit-gift] send threw:", message);
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget wrapper for the admin grant loop: resolves the template
 * strip once per call, sends, and swallows its own errors so a failed email
 * can never fail (or slow-fail) the grant that triggered it.
 */
export async function dispatchCreditGiftEmail(opts: {
  toEmail: string;
  locale: string;
  appOrigin: string;
  credits: number;
  reason?: string;
}): Promise<void> {
  // The covers strip is decorative: if the template query fails (or runs
  // outside the Next runtime, where unstable_cache throws), send WITHOUT
  // it rather than dropping the announcement.
  let templates: WelcomeTemplate[] = [];
  try {
    templates = await getWelcomeTemplates();
  } catch (err) {
    console.warn(
      "[credit-gift] templates strip unavailable, sending without:",
      err instanceof Error ? err.message : String(err),
    );
  }
  try {
    await sendCreditGift({ ...opts, templates });
  } catch (err) {
    console.error(
      "[credit-gift] dispatch failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
