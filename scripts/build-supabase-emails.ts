// Generate the Supabase auth/security email templates from the shared shell.
//
//   npx tsx scripts/build-supabase-emails.ts
//
// Output:
//   docs/auth-emails/<name>.html   — paste-ready Supabase template. One document
//                                    with the AR + EN bodies under a
//                                    `{{ if eq .Data.lang "en" }}` conditional
//                                    (default = Arabic). Uses prod asset URLs.
//   public/email-lab/gen-<name>-<lang>.html — localhost preview (relative asset
//                                    URLs) so the rendered output is verifiable.
//
// Re-run after editing lib/email/shell.ts or the copy below.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  renderEmail,
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
type Tpl = { name: string; ar: Copy; en: Copy };

const TEMPLATES: Tpl[] = [
  {
    name: "confirm-signup",
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
    // Supabase substitutes the action link at send time.
    buttonHref: c.button ? "{{ .ConfirmationURL }}" : undefined,
    footerNoteHtml: c.footer,
    preheader: c.preheader,
    assetBase,
  };
}

for (const t of TEMPLATES) {
  // Supabase: one document, AR + EN bodies under a Go conditional (default AR).
  const supabaseDoc = `<!doctype html>
<html lang="{{ if eq .Data.lang "en" }}en{{ else }}ar{{ end }}" dir="{{ if eq .Data.lang "en" }}ltr{{ else }}rtl{{ end }}">
  <head>
${EMAIL_HEAD}
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "en" }}
${renderEmailBody(paramsFor(t, "en"))}
{{ else }}
${renderEmailBody(paramsFor(t, "ar"))}
{{ end }}
  </body>
</html>
`;
  fs.writeFileSync(
    path.join(root, "docs/auth-emails", `${t.name}.html`),
    supabaseDoc,
  );

  // Localhost previews (relative asset paths so /email/* resolves on :3000).
  for (const lang of ["ar", "en"] as Lang[]) {
    fs.writeFileSync(
      path.join(root, "public/email-lab", `gen-${t.name}-${lang}.html`),
      renderEmail(paramsFor(t, lang, "")),
    );
  }
}

console.log(`Generated ${TEMPLATES.length} Supabase templates + previews.`);
