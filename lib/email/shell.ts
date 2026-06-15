// Shared production email shell for taqreer.ai transactional emails.
//
// One source of truth for the dark email design. Email-safe: table layout,
// inline styles, a flat #111111 canvas (the CSS aurora relied on blur/position
// which Gmail/Outlook drop, so the glow is dropped, keep it simple), a baked
// logo-box PNG (our mark + dark tile + hairline border in ONE image, so no SVG
// in mail and the dark-mode flip can't vanish the glyph), and a fixed font
// stack (Cairo loads in Apple Mail/iOS; the rest fall back to native Arabic /
// Segoe UI / Tahoma).
//
// Used two ways:
//   1. Resend senders (welcome / share / contact) call renderEmail() at send
//      time with the recipient's locale → a single-language email.
//   2. scripts/build-supabase-emails.mjs renders the AR + EN branches and wraps
//      them in Supabase's `{{ if eq .Data.lang "ar" }}…{{ else }}…{{ end }}`
//      Go-template conditional for the dashboard-pasted auth/security templates.

const ASSET_BASE = "https://taqreer.ai";
const ADDRESS = "5830 E 2nd St, Ste 7000, Casper, WY 82609, USA";
const FONT_STACK =
  "'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailShellParams = {
  lang: "ar" | "en";
  // Plain text (already-escaped or trusted). Title + button label are escaped
  // by the caller's data path; sub/footerNote/extraHtml may contain trusted
  // inline HTML (links) the caller assembled, so they are inserted verbatim.
  title: string;
  subHtml: string;
  eyebrowHtml?: string; // pill/eyebrow between the icon and the title (welcome credits)
  buttonLabel?: string;
  buttonHref?: string; // may be a real URL or a Go var like "{{ .ConfirmationURL }}"
  extraHtml?: string; // inserted between the button and the footer (templates / summary / fields)
  footerNoteHtml?: string;
  // Hidden inbox-preview line.
  preheader?: string;
  assetBase?: string;
};

export const EMAIL_HEAD = `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>`;

// The email's <body> inner (preheader + canvas table). renderEmail wraps it in
// a full document; the Supabase generator drops the AR + EN bodies into ONE
// document under a `{{ if eq .Data.lang "en" }}` conditional (default = AR).
export function renderEmailBody(p: EmailShellParams): string {
  const dir = p.lang === "ar" ? "rtl" : "ltr";
  const base = p.assetBase ?? ASSET_BASE;
  const icon = `${base}/email/icon-box.png`;

  const preheader = p.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">${p.preheader}</div>`
    : "";

  const button =
    p.buttonLabel && p.buttonHref
      ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="${p.buttonHref}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">${p.buttonLabel}</a>
                  </td>
                </tr>
              </table>`
      : "";

  const extra = p.extraHtml ?? "";

  const footerNote = p.footerNoteHtml
    ? `<p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">${p.footerNoteHtml}</p>`
    : "";

  return `${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:${FONT_STACK};">
            <tr>
              <td valign="top" align="center" dir="${dir}" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="${icon}" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                ${p.eyebrowHtml ?? ""}
                <h1 style="margin:0;font-size:${p.lang === "ar" ? "30px" : "26px"};font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">${p.title}</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">${p.subHtml}</p>
                ${button}
                ${extra}
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="${dir}" style="padding:56px 36px 84px;text-align:center;">
                ${footerNote}
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />${ADDRESS}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

export function renderEmail(p: EmailShellParams): string {
  const dir = p.lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${p.lang}" dir="${dir}">
  <head>
${EMAIL_HEAD}
  </head>
  <body style="margin:0;padding:0;background:#111111;">
    ${renderEmailBody(p)}
  </body>
</html>`;
}

// ─── Reusable content fragments (returned as `extraHtml`) ──────────────

// Receipt / order summary rows (billing).
export function summaryBlock(
  rows: { label: string; value: string }[],
  dir: "rtl" | "ltr",
): string {
  const start = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";
  const trs = rows
    .map((r, i) => {
      const border =
        i < rows.length - 1
          ? "border-bottom:1px solid rgba(255,255,255,0.06);"
          : "";
      // Rows sit DIRECTLY in the card table (cell padding = the inset), so
      // there's no nested table to collapse. Label cell takes the majority so
      // the value lands hard against the end edge.
      return `
                  <tr>
                    <td align="${start}" width="60%" style="padding:9px 22px;font-size:13px;line-height:1.7;color:#b4b4b4;${border}">${escapeHtml(r.label)}</td>
                    <td align="${end}" style="padding:9px 22px;font-size:13px;line-height:1.7;color:#ffffff;${border}"><bdi dir="ltr">${escapeHtml(r.value)}</bdi></td>
                  </tr>`;
    })
    .join("");
  // ONE table at an explicit PIXEL width = the email content area (600 canvas
  // minus the 40px side padding). Gmail honours a px `width` attribute but
  // shrinks a `width="100%"` table to its content inside the centered content
  // cell (which is why % collapsed it). `max-width:100%` keeps it responsive,
  // `align="center"` centers it if a client ever caps it narrower.
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="520" style="width:520px;max-width:100%;margin:28px auto 0;background:#0A0A0A;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">${trs}
                </table>`;
}

// Template showcase strip (welcome): up to 3 cover thumbnails (16:9), linked.
export function templatesStrip(
  templates: { href: string; src: string }[],
  label: string,
): string {
  if (templates.length === 0) return "";
  const cells = templates
    .slice(0, 3)
    .map(
      (t) => `
                    <td style="padding:0 6px;">
                      <a href="${t.href}" style="display:block;"><img src="${t.src}" width="144" height="81" alt="" style="display:block;width:144px;height:81px;border-radius:10px;border:1px solid rgba(255,255,255,0.10);object-fit:cover;" /></a>
                    </td>`,
    )
    .join("");
  return `
                <p style="margin:56px 0 18px;font-size:13px;font-weight:500;color:#b4b4b4;">${escapeHtml(label)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                  <tr>${cells}
                  </tr>
                </table>`;
}

// Submission detail block (internal contact notification): key/value rows + the
// message body. Left-aligned (team-facing, English).
export function fieldsBlock(
  rows: { label: string; value: string }[],
  message: string,
): string {
  const fs = rows
    .map(
      (r) =>
        `<p style="margin:0 0 4px;font-size:13px;line-height:1.7;color:#b4b4b4;"><span style="color:#6b7079;">${escapeHtml(r.label)}:</span> <span style="color:#ffffff;">${escapeHtml(r.value)}</span></p>`,
    )
    .join("");
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="400" style="margin:24px auto 0;max-width:400px;width:100%;background:#0A0A0A;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
                  <tr><td align="left" style="padding:16px 18px;text-align:left;">
                    ${fs}
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);font-size:14px;line-height:1.7;color:#d6d6d6;white-space:pre-wrap;">${escapeHtml(message)}</div>
                  </td></tr>
                </table>`;
}
