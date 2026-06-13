// Share-invite email sender. Graceful fallback: if Resend env is absent we log
// a redacted stub line and return ok instead of throwing, so the share flow
// keeps working in dev. Rebuilt on the shared email shell (flat dark);
// locale-aware (the inviter's UI locale, default Arabic).

import { Resend } from "resend";
import { renderEmail, escapeHtml } from "./shell";

const ROLE_LABEL: Record<"ar" | "en", Record<string, string>> = {
  ar: { view: "للاطلاع", comment: "للتعليق", edit: "للتعديل" },
  en: { view: "view", comment: "comment", edit: "edit" },
};

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export type SendShareInviteInput = {
  toEmail: string;
  ownerName: string | null;
  ownerEmail: string;
  projectTitle: string;
  accessLevel: "view" | "comment" | "edit";
  inviteToken: string;
  appOrigin: string;
  locale?: string;
};

export type SendShareInviteResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

export async function sendShareInvite(
  input: SendShareInviteInput,
): Promise<SendShareInviteResult> {
  const acceptUrl = `${input.appOrigin}/api/invitations/${encodeURIComponent(input.inviteToken)}/accept`;
  const from = process.env.RESEND_FROM_EMAIL;
  const client = getClient();

  // No Resend env — log (redacted: never the recipient email or the redeemable
  // accept URL, both sensitive) and return ok so dev flows don't break.
  if (!client || !from) {
    console.info(
      "[share-invite] Resend not configured — stubbed send",
      JSON.stringify({
        projectTitle: input.projectTitle,
        accessLevel: input.accessLevel,
        tokenHint: `…${input.inviteToken.slice(-4)}`,
      }),
    );
    return { ok: true, provider: "stub" };
  }

  const lang: "ar" | "en" = input.locale === "en" ? "en" : "ar";
  const senderName = escapeHtml(input.ownerName?.trim() || input.ownerEmail);
  const deck = escapeHtml(input.projectTitle);
  const role = ROLE_LABEL[lang][input.accessLevel] ?? input.accessLevel;

  const copy =
    lang === "ar"
      ? {
          subject: `${input.ownerName?.trim() || input.ownerEmail} شارك معك عرضًا على taqreer.ai`,
          preheader: "افتح العرض وابدأ التعاون مباشرة من المتصفح.",
          title: "تمت مشاركة عرض معك",
          sub: `شارك ${senderName} معك عرض «${deck}» على taqreer.ai ${role}. يمكنك فتحه الآن والعمل عليه مباشرة من المتصفح.`,
          button: "فتح العرض",
          footer: "إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.",
        }
      : {
          subject: `${input.ownerName?.trim() || input.ownerEmail} shared a deck with you on taqreer.ai`,
          preheader: "Open the deck and start collaborating in the browser.",
          title: "A deck was shared with you",
          sub: `${senderName} shared &ldquo;${deck}&rdquo; with you on taqreer.ai (${role} access). Open it to view and collaborate right in the browser.`,
          button: "Open deck",
          footer: "If you weren't expecting this invite, you can ignore this email.",
        };

  const html = renderEmail({
    lang,
    preheader: copy.preheader,
    title: copy.title,
    subHtml: copy.sub,
    buttonLabel: copy.button,
    buttonHref: acceptUrl,
    footerNoteHtml: copy.footer,
  });

  try {
    const res = await client.emails.send({
      from,
      to: input.toEmail,
      subject: copy.subject,
      html,
    });
    if (res.error) {
      console.error("[share-invite] Resend send error:", res.error.message);
      return { ok: false, error: res.error.message };
    }
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[share-invite] send threw:", message);
    return { ok: false, error: message };
  }
}
