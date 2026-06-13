// Contact-form email sender. Same Resend pattern as send-share-invite.ts:
// lazy cached client, graceful stub when env is missing (so dev works without
// Resend), structured result, never throws to the caller.
//
// SECURITY: `from` is always our verified RESEND_FROM_EMAIL; the routed `to`
// comes from the server-side DEPARTMENT_EMAILS map (never the client). The
// submitter's address goes in replyTo + the body, so a reply from the inbox
// reaches them, but it never controls the envelope.

import { Resend } from "resend";

let cachedClient: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export type SendContactInput = {
  toEmail: string; // resolved department inbox (server-mapped)
  departmentLabel: string;
  fromName: string;
  fromEmail: string;
  message: string;
};

export type SendContactResult =
  | { ok: true; provider: "resend" | "stub"; messageId?: string }
  | { ok: false; error: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendContact(
  input: SendContactInput,
): Promise<SendContactResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  const client = getClient();

  if (!client || !from) {
    console.info(
      "[contact] Resend not configured, stubbed send",
      JSON.stringify({ department: input.departmentLabel }),
    );
    return { ok: true, provider: "stub" };
  }

  const subject = `New ${input.departmentLabel} message from ${input.fromName}`;
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">` +
    `<p style="margin:0 0 12px"><strong>Department:</strong> ${esc(input.departmentLabel)}</p>` +
    `<p style="margin:0 0 12px"><strong>From:</strong> ${esc(input.fromName)} &lt;${esc(input.fromEmail)}&gt;</p>` +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0" />` +
    `<p style="white-space:pre-wrap;margin:0">${esc(input.message)}</p>` +
    `</div>`;
  const text =
    `Department: ${input.departmentLabel}\n` +
    `From: ${input.fromName} <${input.fromEmail}>\n\n` +
    `${input.message}`;

  try {
    const res = await client.emails.send({
      from,
      to: input.toEmail,
      replyTo: input.fromEmail,
      subject,
      html,
      text,
    });
    if (res.error) {
      console.error("[contact] Resend send error:", res.error.message);
      return { ok: false, error: res.error.message };
    }
    return { ok: true, provider: "resend", messageId: res.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    console.error("[contact] Resend send threw:", message);
    return { ok: false, error: message };
  }
}
