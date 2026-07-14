// Comp-tier email - sent when an admin grants a user a complimentary paid
// tier for 1 month (the admin Users panel "Grant test tier" action). Same
// shell + structure as the welcome / credit-gift emails (pill, title, CTA,
// templates strip), comp wording. Locale-aware per User.language.
//
// Same graceful pattern as send-credit-gift: stubs (logs + returns ok) when
// Resend env is absent so local grants don't break, never throws.

import { Resend } from "resend";
import { renderEmail, templatesStrip, ltrIsolate } from "./shell";
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

const BR = ltrIsolate("taqreer.ai");

// Build the locale copy. The tier label (Plus / Pro / Max) is a Latin product
// name, LTR-isolated inside the Arabic copy so it keeps order (Outlook bidi).
function copyFor(lang: "ar" | "en", tierLabel: string) {
  const T = lang === "ar" ? ltrIsolate(tierLabel) : tierLabel;
  if (lang === "ar") {
    return {
      subject: `تم اختيارك: شهر مجاني من خطة ${T} على ${BR}`,
      preheader: `حسابك الآن على خطة ${T} مجانا لمدة شهر، دون أي رسوم.`,
      pill: `${T} - شهر مجاني`,
      title: `تم اختيارك`,
      sub: `رفعنا حسابك إلى خطة ${T} مجانا لمدة شهر كامل، هدية منا لتجربة جميع مزايا الخطة، بما في ذلك حدود استخدام أعلى، وجميع صيغ التصدير، والقوالب المميزة.<br /><br />الخطة مفعلة على حسابك الآن، دون أي رسوم أو أي خطوات إضافية.`,
      button: "ابدأ الإنشاء",
      templatesLabel: "أو ابدأ من قالب جاهز",
      footerNote: `وصلك هذا البريد لأن حسابك على ${BR} تمت ترقيته إلى خطة ${T} مجانية لمدة شهر. لأي استفسار، تواصل معنا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.`,
    };
  }
  return {
    subject: `You've been selected: 1 month of ${tierLabel} on taqreer.ai, free`,
    preheader: `Your account is on ${tierLabel} free for 1 month, no charge.`,
    pill: `${tierLabel} - 1 month free`,
    title: "You've been selected",
    sub: `We've placed your account on the ${tierLabel} plan, free for a full month. It's our gift so you can explore everything ${tierLabel} unlocks: higher limits, every export format, and premium templates. It's live in your account right now, with no charge and nothing to set up.`,
    button: "Start creating",
    templatesLabel: "Or start from a ready-made template",
    footerNote: `You received this because your taqreer.ai account was upgraded to a complimentary ${tierLabel} plan for 1 month. Questions? Reach us at <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.`,
  };
}

function tierPill(label: string): string {
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
                  <tr><td style="background:#16233a;border:1px solid rgba(51,128,255,0.30);border-radius:999px;padding:6px 15px;font-size:12px;font-weight:600;color:#66A3FF;">${label}</td></tr>
                </table>`;
}

export type SendCompTierInput = {
  toEmail: string;
  locale: string;
  appOrigin: string;
  templates: WelcomeTemplate[];
  // Display label of the granted tier, e.g. "Plus" / "Pro" / "Max".
  tierLabel: string;
};

export type SendCompTierResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

export async function sendCompTier(
  input: SendCompTierInput,
): Promise<SendCompTierResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  const client = getClient();
  const lang: "ar" | "en" = input.locale === "en" ? "en" : "ar";
  const c = copyFor(lang, input.tierLabel);

  if (!client || !from) {
    console.info("[comp-tier] Resend not configured - stubbed send", lang);
    return { ok: true, provider: "stub" };
  }

  const tstrip = templatesStrip(
    input.templates.map((t) => ({
      href: `${input.appOrigin}/${lang}/templates`,
      src: t.cover,
    })),
    c.templatesLabel,
  );

  const html = renderEmail({
    lang,
    preheader: c.preheader,
    eyebrowHtml: tierPill(c.pill),
    title: c.title,
    subHtml: c.sub,
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
      console.error("[comp-tier] Resend send error:", res.error.message);
      return { ok: false, error: res.error.message };
    }
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[comp-tier] send threw:", message);
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget wrapper for the admin grant action: resolves the template
 * strip once, sends, and swallows its own errors so a failed email can never
 * fail (or slow-fail) the comp grant that triggered it.
 */
export async function dispatchCompTierEmail(opts: {
  toEmail: string;
  locale: string;
  appOrigin: string;
  tierLabel: string;
}): Promise<void> {
  let templates: WelcomeTemplate[] = [];
  try {
    templates = await getWelcomeTemplates();
  } catch (err) {
    console.warn(
      "[comp-tier] templates strip unavailable, sending without:",
      err instanceof Error ? err.message : String(err),
    );
  }
  try {
    await sendCompTier({ ...opts, templates });
  } catch (err) {
    console.error(
      "[comp-tier] dispatch failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
