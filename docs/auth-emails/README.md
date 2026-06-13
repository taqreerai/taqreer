# Supabase auth emails — Resend SMTP + branded bilingual templates

Goal: signup-confirm / password-reset / email-change emails go out the
authenticated `taqreer.ai` path (so they land in the inbox, not spam) and look
like the product (bilingual, brand blue).

DNS state (audited 2026-06-13, already in place, nothing to add):
- DKIM `resend._domainkey.taqreer.ai` valid (domain verified in Resend)
- SPF: root includes Google Workspace; `send.taqreer.ai` includes amazonses
  (Resend envelope) so Resend mail passes SPF
- DMARC `p=quarantine`, relaxed alignment, passes via DKIM
- MX: Google Workspace (so contact@/support@/billing@ receive mail)

Optional later: point DMARC `rua` at an address we monitor (currently a GoDaddy
default). Not a launch blocker.

---

## Step 1 - Supabase custom SMTP (Resend)

Supabase Dashboard -> Project Settings -> Authentication -> SMTP Settings ->
enable "Custom SMTP" and set:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key (see note) |
| Sender email | `no-reply@taqreer.ai` |
| Sender name | `taqreer.ai` |
| Minimum interval | leave default |

Notes:
- ‼️ The Password is a Resend API key. **You enter this**, not me (I don't type
  API keys into fields). Reuse the existing send-only key, or better, create a
  dedicated one in Resend (API Keys -> Create, sending access) named
  `supabase-smtp` so it can be rotated independently.
- `no-reply@taqreer.ai` does not need a real mailbox, Resend can send from any
  address on the verified domain. Set the templates' reply hint to support@.
- This Supabase project is shared by dev + prod, so this switches BOTH to
  Resend. That's intended (dev volume is tiny).
- After saving, send yourself a password-reset from the live site and confirm
  it arrives from `no-reply@taqreer.ai` and lands in the inbox.

Supabase's default auth-email rate limit is very low. After custom SMTP is on,
raise it under Authentication -> Rate Limits (email) to a sane number for
launch (e.g. 30-100/hour) since Resend can handle it.

---

## Step 2 - Templates

Supabase Dashboard -> Authentication -> Email Templates. For each type below,
paste the matching HTML file into the "Message body" (source) and set the
Subject. Templates are bilingual (Arabic block first, then English), brand blue,
Latin numerals, no em dashes.

| Supabase template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `فعّل حسابك في taqreer.ai · Activate your taqreer.ai account` |
| Reset password | `reset-password.html` | `إعادة تعيين كلمة المرور · Reset your taqreer.ai password` |
| Change email address | `change-email.html` | `تأكيد بريدك الجديد · Confirm your new taqreer.ai email` |

All three use `{{ .ConfirmationURL }}` as the action link (Supabase populates it).
The app does not use Magic Link / Invite / Reauthentication, so those defaults
can stay (or mirror one of these later).

Verify after pasting: trigger each flow on the live site (signup, forgot
password, settings email change) and confirm the email renders correctly in
Gmail (LTR + RTL blocks, button works).
