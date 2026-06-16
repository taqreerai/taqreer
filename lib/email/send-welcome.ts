// Welcome email — sent once when a new user row is born (user-sync, next to the
// signup credit grant). Tells the user they have credits, what taqreer.ai does,
// and shows the most-recent public templates to start from. Locale-aware.
//
// Same graceful pattern as send-share-invite: stubs (logs + returns ok) when
// Resend env is absent so dev signups don't break, never throws.

import { Resend } from "resend";
import { renderEmail, templatesStrip, ltrIsolate } from "./shell";
import {
  getWelcomeTemplates,
  type WelcomeTemplate,
} from "@/lib/auth/marquee-projects";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

// Brand pre-isolated so it keeps LTR order inside the Arabic copy (Outlook bidi).
const BR = ltrIsolate("taqreer.ai");

const COPY = {
  ar: {
    subject: `مرحبًا بك في ${BR}`,
    preheader: "أضفنا 400 رصيد مجاني إلى حسابك لتبدأ أول عرض.",
    credits: "400 رصيد مجاني مضافة لحسابك",
    title: `مرحبًا بك في ${BR}`,
    sub: `ابدأ من فكرة، نص، أو ملف، ودع ${BR} يحوّله إلى عرض مصمم وجاهز للتعديل بالعربية أو الإنجليزية. أضفنا رصيدك المجاني، ويمكنك إنشاء أول عرض الآن.`,
    button: "ابدأ الإنشاء",
    templatesLabel: "أو ابدأ من قالب جاهز",
    footerNote:
      'يسعدنا انضمامك. لأي مساعدة، تواصل معنا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.',
  },
  en: {
    subject: "Welcome to taqreer.ai",
    preheader: "400 free credits have been added to your account.",
    credits: "400 free credits added",
    title: "Welcome to taqreer.ai",
    sub: "Turn your ideas into fully designed presentations in Arabic and English, then export them to PowerPoint. Your credits are ready whenever you are.",
    button: "Start creating",
    templatesLabel: "Or start from a ready-made template",
    footerNote:
      'We\'re glad you\'re here. Need a hand? Reach us at <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.',
  },
} as const;

function creditsPill(label: string): string {
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
                  <tr><td style="background:#16233a;border:1px solid rgba(51,128,255,0.30);border-radius:999px;padding:6px 15px;font-size:12px;font-weight:600;color:#66A3FF;">${label}</td></tr>
                </table>`;
}

export type SendWelcomeInput = {
  toEmail: string;
  locale: string;
  appOrigin: string;
  templates: WelcomeTemplate[];
};

export type SendWelcomeResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

export async function sendWelcome(
  input: SendWelcomeInput,
): Promise<SendWelcomeResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  const client = getClient();
  const lang: "ar" | "en" = input.locale === "en" ? "en" : "ar";
  const c = COPY[lang];

  if (!client || !from) {
    console.info("[welcome] Resend not configured — stubbed send", lang);
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
    eyebrowHtml: creditsPill(c.credits),
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
      console.error("[welcome] Resend send error:", res.error.message);
      return { ok: false, error: res.error.message };
    }
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[welcome] send threw:", message);
    return { ok: false, error: message };
  }
}

// Resolve the new user's locale, then send the welcome ONCE. BOTH routes that
// can land the signup grant (user-sync + projects) call this when their grant
// returns granted>0. The grant is row-locked + idempotent, so exactly one of
// them reports granted>0 — the welcome therefore sends exactly once regardless
// of which route won the race (the bug it fixes: only user-sync sent it, so
// when /api/projects granted first the welcome was silently dropped).
//
// Fire-and-forget friendly: resolves templates + locale, sends, and swallows
// its own errors so it never blocks or fails the caller.
export async function dispatchWelcomeEmail(opts: {
  toEmail: string;
  // Supabase user.user_metadata?.lang (the signup-form locale) — preferred.
  metadataLang: string | null | undefined;
  // The request "cookie" header — tq_locale fallback.
  cookieHeader: string | null;
  // The account's stored language — final fallback.
  fallbackLocale: string;
  appOrigin: string;
}): Promise<void> {
  const cookieLocale = opts.cookieHeader
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  const locale = isLocale(opts.metadataLang)
    ? (opts.metadataLang as string)
    : isLocale(cookieLocale)
      ? (cookieLocale as string)
      : opts.fallbackLocale;
  try {
    const templates = await getWelcomeTemplates();
    await sendWelcome({
      toEmail: opts.toEmail,
      locale,
      appOrigin: opts.appOrigin,
      templates,
    });
  } catch (err) {
    console.error(
      "[welcome] dispatch failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
