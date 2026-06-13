# Supabase auth emails — Resend SMTP + locale-aware templates

Goal: signup-confirm / reset / email-change / security-notice emails go out the
authenticated `taqreer.ai` path (inbox, not spam) and look like the product:
flat dark, one baked logo-box PNG, brand blue, Latin numerals, no em dash.

Design lives in the shared shell `lib/email/shell.ts` (which ALSO drives the
code-sent welcome / share-invite / contact emails — one source of truth). The
CSS aurora glow was dropped after it half-flipped in Gmail dark mode: flat
`#111111` + a single baked PNG (`public/email/icon-box.png` = mark + tile +
hairline border, in ONE image so the dark-mode flip can't vanish it).

## Status (2026-06-13)

- ✅ Custom SMTP (Resend) ENABLED in Supabase: `smtp.resend.com:465`, user
  `resend`, sender `no-reply@taqreer.ai`. Password = a Resend send-only key
  (entered by Osama; I don't type secrets). Shared dev+prod project.
- ✅ DNS authenticated: Resend DKIM (`resend._domainkey`), SPF (root=Google,
  `send.`=amazonses), DMARC `p=quarantine`, Workspace MX.
- ✅ The 5 templates are generated + PASTED into the dashboard.

REMAINING:
- ‼️ Site URL is still `http://localhost:3000` → set to `https://taqreer.ai`
  (Authentication → URL Configuration). It's the default redirect + exposed as
  `{{ .SiteURL }}`.
- Bump the auth-email rate limit (currently 30/h) under Auth → Rate Limits.
- CODE TODO: exempt `/callback` from the coming-soon gate (proxy.ts
  `alwaysPublic`) so a fresh signup's confirm link + Google OAuth complete
  pre-launch — today they only work for `tq_preview`-cookie holders.
- Gmail smoke-test each flow (signup confirm + welcome, reset, email change).
- Optional later: point DMARC `rua` at an inbox we monitor (GoDaddy default).

## The 5 templates

Edit copy in `scripts/build-supabase-emails.ts`, run
`npx tsx scripts/build-supabase-emails.ts` → regenerates `docs/auth-emails/*.html`,
then rebuild the paste sheet. **Paste from `PASTE-INTO-SUPABASE.md`** (subjects +
bodies, byte-exact) into Authentication → Emails.

Each template is ONE document with the AR + EN bodies under a Go conditional:
`{{ if eq .Data.lang "ar" }}…{{ else }}…{{ end }}` — Arabic is the explicit
branch, English the default (covers accounts created before signup persisted
`lang` in user_metadata). The 3 core templates use `{{ .ConfirmationURL }}`.

| Supabase template | File | Notes |
|---|---|---|
| Confirm signup | `confirm-signup.html` | button |
| Reset password | `reset-password.html` | button |
| Change email address | `change-email.html` | button |
| Password changed | `password-changed.html` | security notice, no button — flip ON "Enable notification" |
| Email changed | `email-changed.html` | security notice, no button — flip ON "Enable notification" |

> Dashboard caveat: the Preview never evaluates Go conditionals, so it shows the
> literal `{{ if }}` + both branches. The actual send evaluates `.Data.lang`
> (set by the signup form via `data: { lang }`) and picks one language.

The app doesn't use Magic Link / Invite / Reauthentication — those defaults stay.
