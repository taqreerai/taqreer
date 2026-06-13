// Contact-form email sender (internal — goes to a team inbox). Same Resend
// pattern as the others: lazy client, graceful stub, never throws. Rebuilt on
// the shared shell so the team notification matches the brand. English-only
// (team-facing); the submitter rides in replyTo + the body, never the envelope.
//
// SECURITY: `from` is always our verified RESEND_FROM_EMAIL; the routed `to`
// comes from the server-side DEPARTMENT_EMAILS map (never the client).

import { Resend } from "resend";
import { renderEmail, fieldsBlock } from "./shell";

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
  const html = renderEmail({
    lang: "en",
    title: "New contact message",
    subHtml: "A visitor submitted the contact form on taqreer.ai.",
    extraHtml: fieldsBlock(
      [
        { label: "From", value: input.fromName },
        { label: "Email", value: input.fromEmail },
        { label: "Department", value: input.departmentLabel },
      ],
      input.message,
    ),
    buttonLabel: "Reply",
    buttonHref: `mailto:${input.fromEmail}`,
    footerNoteHtml:
      "Reply-to is set to the sender, just hit reply to respond directly.",
  });
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
