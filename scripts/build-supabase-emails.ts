// Generate the Supabase auth/security email templates from the shared shell.
//
//   npx tsx scripts/build-supabase-emails.ts
//
// Output: docs/auth-emails/<name>.html — paste-ready Supabase template. One
// document with the AR + EN bodies under a `{{ if eq .Data.lang "ar" }}`
// conditional (Arabic explicit, English default). Uses prod asset URLs.
//
// Re-run after editing lib/email/shell.ts or the copy below.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  renderEmailBody,
  EMAIL_HEAD,
  type EmailShellParams,
} from "../lib/email/shell";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const support = `<a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>`;

type Lang = "ar" | "en";
type Copy = {
  title: string;
  sub: string;
  button?: string;
  footer?: string;
  preheader?: string;
};
type Tpl = {
  name: string;
  ar: Copy;
  en: Copy;
  // When set, the action button links to OUR /confirm route (token-hash verify
  // on taqreer.ai) instead of Supabase's *.supabase.co ConfirmationURL.
  verify?: { type: "email" | "recovery" | "email_change"; next: string };
};

const TEMPLATES: Tpl[] = [
  {
    name: "confirm-signup",
    verify: { type: "email", next: "/dashboard" },
    ar: {
      preheader: "خطوة أخيرة لتفعيل حسابك في taqreer.ai.",
      title: "أكّد بريدك الإلكتروني",
      sub: "بقيت خطوة واحدة لتفعيل حسابك. اضغط الزر أدناه لتأكيد بريدك الإلكتروني والبدء في إنشاء عروضك على taqreer.ai.",
      button: "تأكيد البريد الإلكتروني",
      footer: "إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.",
    },
    en: {
      preheader: "One last step to activate your account.",
      title: "Activate your account",
      sub: "Thanks for joining taqreer.ai. Confirm your email to activate your account and start building presentations.",
      button: "Confirm email",
      footer: "If you didn't create this account, you can safely ignore this email.",
    },
  },
  {
    name: "reset-password",
    verify: { type: "recovery", next: "/reset-password" },
    ar: {
      preheader: "استخدم الرابط لاختيار كلمة مرور جديدة.",
      title: "إعادة تعيين كلمة المرور",
      sub: "تلقّينا طلبًا لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة. الرابط صالح لمدة محدودة حفاظًا على أمان حسابك.",
      button: "إعادة تعيين كلمة المرور",
      footer: "إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.",
    },
    en: {
      preheader: "Use the link to choose a new password.",
      title: "Reset your password",
      sub: "We received a request to reset your password. Choose a new one below. This link is valid for a limited time.",
      button: "Reset password",
      footer: "If you didn't request this, ignore this email and your password stays unchanged.",
    },
  },
  {
    name: "change-email",
    verify: { type: "email_change", next: "/settings" },
    ar: {
      preheader: "أكّد العنوان الجديد لتحديث بريد حسابك.",
      title: "تأكيد بريدك الجديد",
      sub: "اضغط الزر أدناه لتأكيد عنوان بريدك الإلكتروني الجديد. لن يتم تحديث بريد حسابك حتى يتم التأكيد.",
      button: "تأكيد البريد الجديد",
      footer: `إذا لم تطلب هذا التغيير، تواصل معنا على ${support}.`,
    },
    en: {
      preheader: "Confirm the new address to update your account email.",
      title: "Confirm your new email",
      sub: "Confirm your new email address below. The change doesn't take effect until you confirm it.",
      button: "Confirm new email",
      footer: `If you didn't request this change, contact ${support}.`,
    },
  },
  {
    name: "password-changed",
    ar: {
      preheader: "إشعار أمان من taqreer.ai.",
      title: "تم تغيير كلمة المرور",
      sub: `تم تغيير كلمة مرور حسابك بنجاح. إذا لم تكن أنت من قام بهذا التغيير، تواصل معنا فورًا على ${support}.`,
    },
    en: {
      preheader: "Security alert from your taqreer.ai account.",
      title: "Your password was changed",
      sub: `Your taqreer.ai account password was changed successfully. If this wasn't you, contact us right away at ${support}.`,
    },
  },
  {
    name: "email-changed",
    ar: {
      preheader: "إشعار أمان من taqreer.ai.",
      title: "تم تغيير البريد الإلكتروني",
      sub: `تم تحديث البريد الإلكتروني المرتبط بحسابك. إذا لم تكن أنت من طلب هذا التغيير، تواصل معنا فورًا على ${support}.`,
    },
    en: {
      preheader: "Security alert from your taqreer.ai account.",
      title: "Your email was changed",
      sub: `The email address on your taqreer.ai account was updated. If this wasn't you, contact us right away at ${support}.`,
    },
  },
];

function paramsFor(t: Tpl, lang: Lang, assetBase?: string): EmailShellParams {
  const c = t[lang];
  return {
    lang,
    title: c.title,
    subHtml: c.sub,
    buttonLabel: c.button,
    // Link the button to OUR /confirm route (token-hash verify) so auth emails
    // stay on taqreer.ai rather than the *.supabase.co verify endpoint (which
    // Outlook flags as a sender/link mismatch and junks). `&amp;` is the
    // HTML-escaped separator; the static text isn't run through Go's escaper the
    // way the {{ }} vars are, so we write it pre-escaped. Falls back to
    // ConfirmationURL for any future button template without a verify type.
    buttonHref: c.button
      ? t.verify
        ? `{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&amp;type=${t.verify.type}&amp;next=${encodeURIComponent(`/${lang}${t.verify.next}`)}`
        : "{{ .ConfirmationURL }}"
      : undefined,
    footerNoteHtml: c.footer,
    preheader: c.preheader,
    assetBase,
  };
}

for (const t of TEMPLATES) {
  // Supabase: one document, AR + EN bodies under a Go conditional. Arabic is the
  // explicit branch; English is the else/default (covers users whose metadata
  // has no `lang`, e.g. accounts created before signup started persisting it).
  const supabaseDoc = `<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
${EMAIL_HEAD}
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
${renderEmailBody(paramsFor(t, "ar"))}
{{ else }}
${renderEmailBody(paramsFor(t, "en"))}
{{ end }}
  </body>
</html>
`;
  fs.writeFileSync(
    path.join(root, "docs/auth-emails", `${t.name}.html`),
    supabaseDoc,
  );
}

console.log(`Generated ${TEMPLATES.length} Supabase templates.`);
