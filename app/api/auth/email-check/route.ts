// POST /api/auth/email-check  { email } -> { disposable: boolean }
//
// Lets the signup form refuse throwaway inboxes (mailinator, temp-mail, ...)
// before the account is created (2026-10-02). Pre-auth by design. Answers
// only "is this DOMAIN a known throwaway" from a static list: it never looks
// up accounts, so it can't be used to enumerate users. The enforcing layer is
// the signup-grant guard (lib/credits/signup.ts), which gives such accounts
// no free credits even if this check is skipped.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { isDisposableEmail } from "@/lib/auth/disposable-email";

export async function POST(request: Request) {
  const limited = rateLimited(`email-check:${clientIp(request)}`, 30, 10 * 60_000);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.slice(0, 320) : "";
  return NextResponse.json({ disposable: email ? isDisposableEmail(email) : false });
}
