// Share-invite email sender. Wraps the Resend SDK with a graceful
// fallback: if env isn't configured (RESEND_API_KEY / RESEND_FROM_EMAIL
// missing), we log a stub line and return ok instead of throwing. That
// way the share flow keeps working in dev without forcing every
// developer to provision Resend; only production needs the env wired.
//
// Email body is RTL Arabic (matches the app's primary language) with
// the owner name + project title + role + accept URL. The accept URL
// goes to /api/invitations/[token]/accept which links the userId and
// redirects into the deck.

import { Resend } from "resend";

const ROLE_LABEL_AR: Record<string, string> = {
  view: "عرض",
  comment: "تعليق",
  edit: "تعديل",
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

  // No Resend env configured — log + return ok so dev flows don't
  // break. Redacted: we never write the recipient email or the
  // redeemable accept URL to the log. Both are sensitive (PII +
  // bearer credential respectively) and routine server logs are a
  // notorious credential-leak surface (CI scrapers, Sentry, Vercel
  // log retention). The owner already has the same data in their
  // own modal state if they need to manually retry locally.
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

  const senderName = input.ownerName?.trim() || input.ownerEmail;
  const subject = `${senderName} شاركك عرضاً على تقرير`;
  const roleAr = ROLE_LABEL_AR[input.accessLevel] ?? input.accessLevel;

  try {
    const res = await client.emails.send({
      from,
      to: input.toEmail,
      subject,
      html: buildHtml({
        senderName,
        senderEmail: input.ownerEmail,
        projectTitle: input.projectTitle,
        roleAr,
        acceptUrl,
      }),
      text: buildText({
        senderName,
        projectTitle: input.projectTitle,
        roleAr,
        acceptUrl,
      }),
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

// ─── Templates ─────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(p: {
  senderName: string;
  senderEmail: string;
  projectTitle: string;
  roleAr: string;
  acceptUrl: string;
}): string {
  const sender = escapeHtml(p.senderName);
  const senderEmail = escapeHtml(p.senderEmail);
  const title = escapeHtml(p.projectTitle);
  const role = escapeHtml(p.roleAr);
  // Inline styles — email clients strip <style>. Single-column,
  // 560px max-width, system font fallbacks (Tajawal isn't going to
  // load reliably in Gmail / Outlook). Brand-gradient CTA matches
  // the app's primary buttons via a hard-coded value (CSS vars
  // don't resolve in mail clients).
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:24px 0; background:#0E0E18; color:#ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tajawal, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; margin:0 auto; background:#15151f; border:1px solid rgba(255,255,255,0.08); border-radius:16px; overflow:hidden;">
      <tr>
        <td style="padding:28px 32px 8px 32px; text-align:right;">
          <div style="font-size:14px; color:#b4b4b4; margin-bottom:8px;">${sender} (${senderEmail}) دعاك إلى</div>
          <h1 style="margin:0; font-size:22px; font-weight:700; color:#ffffff;">${title}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px; text-align:right;">
          <div style="font-size:14px; color:#b4b4b4; line-height:1.7;">
            تم منحك مستوى وصول <strong style="color:#ffffff;">«${role}»</strong> على هذا العرض.
            اضغط الزر أدناه لقبول الدعوة وفتح العرض.
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 32px 32px; text-align:right;">
          <a href="${p.acceptUrl}" style="display:inline-block; padding:12px 24px; background:linear-gradient(90deg,#370BF4,#E036B8); color:#ffffff; text-decoration:none; border-radius:9999px; font-size:14px; font-weight:600;">قبول الدعوة وفتح العرض</a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px 32px; text-align:right;">
          <div style="font-size:11px; color:#5a5a6b; line-height:1.6;">
            إذا لم يعمل الزر، انسخ هذا الرابط والصقه في المتصفح:<br/>
            <span dir="ltr" style="color:#8a8a99; word-break:break-all;">${p.acceptUrl}</span>
          </div>
        </td>
      </tr>
    </table>
    <div style="text-align:center; padding-top:16px; font-size:11px; color:#5a5a6b;">تقرير · taqreer.ai</div>
  </body>
</html>`;
}

function buildText(p: {
  senderName: string;
  projectTitle: string;
  roleAr: string;
  acceptUrl: string;
}): string {
  return `${p.senderName} شاركك عرضاً على تقرير

العرض: ${p.projectTitle}
مستوى الوصول: ${p.roleAr}

افتح هذا الرابط لقبول الدعوة:
${p.acceptUrl}

— تقرير · taqreer.ai`;
}
