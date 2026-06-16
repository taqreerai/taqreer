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
// On success the session lands in cookies and we 302 to `next`; on a bad /
// expired / missing token we send them to login with an error flag.

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { defaultLocale } from "@/lib/i18n/config";
import { siteOrigin } from "@/lib/api/site-origin";
import type { EmailOtpType } from "@supabase/supabase-js";

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

  // Only follow a same-origin relative `next` so the token can't be used to
  // bounce a verified session off to an attacker-controlled host.
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : `/${defaultLocale}/dashboard`;

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, origin));
    }
  }

  const loginUrl = new URL(`/${defaultLocale}/login`, origin);
  loginUrl.searchParams.set("error", "link_expired");
  return NextResponse.redirect(loginUrl);
}
