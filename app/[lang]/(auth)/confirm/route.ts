// GET /[lang]/confirm — verify a Supabase email OTP (token_hash) on OUR domain.
//
// Auth emails used to link straight to the project's `*.supabase.co/auth/v1/
// verify` endpoint. That random subdomain (a) doesn't match the sender domain
// (taqreer.ai), which Outlook/Microsoft treat as a phishing signal and junk,
// and (b) isn't branded. The email templates now point here instead, with the
// Supabase `{{ .TokenHash }}` + a `type`, and we run verifyOtp ourselves.
//
// One route covers every emailed token (per Supabase's verifyOtp types):
//   • confirm signup  -> type=email        -> establishes a full session
//   • reset password  -> type=recovery     -> establishes a recovery session
//                        (the /reset-password page then reads it + sets the pw)
//   • change email    -> type=email_change
// On success the session lands in cookies and we 302 to where the sign-up
// started: the account's `resume_to` metadata (set by the /signup form,
// 2026-10-07: a visitor who signed up from /create lands back on
// /create?resume=generate, not the dashboard), else the link's own `next`,
// else the dashboard. Every target goes through safeNextPath. On a bad /
// expired / missing token we send them to login with an error flag.

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n/config";
import { siteOrigin } from "@/lib/api/site-origin";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth/safe-next";

// Only the token types our own templates emit (build-supabase-emails.ts). We
// don't run Supabase magic-link / invite / legacy-signup flows, so accepting
// those would just widen the verify surface for no use. Matches the 3 documented
// above.
const ALLOWED_TYPES = new Set<EmailOtpType>([
  "email",
  "recovery",
  "email_change",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  // External origin, NOT request.url (= localhost:3100 in a prod route handler).
  const origin = siteOrigin(request);

  // Only follow a same-origin path (safeNextPath) so the token can't be used
  // to bounce a verified session off to an attacker-controlled host.
  const fallback = safeNextPath(next, origin) ?? `/${defaultLocale}/dashboard`;

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      // `resume_to` only for sign-up confirmation (the one flow that sets it).
      const resumeTo =
        type === "email" ? data.user?.user_metadata?.resume_to : undefined;
      const target =
        (typeof resumeTo === "string" ? safeNextPath(resumeTo, origin) : null) ??
        fallback;
      return NextResponse.redirect(new URL(target, origin));
    }
  }

  const loginUrl = new URL(`/${defaultLocale}/login`, origin);
  loginUrl.searchParams.set("error", "link_expired");
  return NextResponse.redirect(loginUrl);
}

