// POST /api/admin/credits/grant - admin grants credits to one user or all.
//
// Admin-only (requireAdminApi). Mirrors the Stripe-webhook top-up path: each
// grant is a grantTopup with a unique sourceKey so it's idempotent on retry and
// audited (UsageEvent eventType "credit.grant.topup"). "all" loops every user
// (fine at admin scale). notify:true broadcasts the balance change to the user.
// sendEmail:true additionally sends the credit-gift email per granted user
// (per-user locale; awaited but error-swallowing, so a bad send never fails
// the grant it announces).

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { grantTopup } from "@/lib/credits/server";
import { dispatchCreditGiftEmail } from "@/lib/email/send-credit-gift";

export async function POST(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as {
    target?: string;
    amount?: number;
    sendEmail?: boolean;
    reason?: string;
  } | null;

  const target = body?.target;
  const amount = body?.amount;
  const sendEmail = body?.sendEmail === true;
  // The modal's optional Reason field: audited on the grant event, and
  // when the email is sent it replaces the generic gift paragraph.
  const reason =
    typeof body?.reason === "string"
      ? body.reason.trim().slice(0, 500) || undefined
      : undefined;
  if (!target || !Number.isInteger(amount) || (amount ?? 0) <= 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const credits = amount as number;

  // One id per grant action; the per-user suffix keeps each grantTopup unique.
  const grantId = crypto.randomUUID();

  const recipientSelect = { id: true, email: true, language: true } as const;
  let recipients: { id: string; email: string; language: string }[];
  if (target === "all") {
    recipients = await prisma.user.findMany({ select: recipientSelect });
  } else {
    const u = await prisma.user.findUnique({
      where: { id: target },
      select: recipientSelect,
    });
    if (!u) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }
    recipients = [u];
  }

  const appOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://taqreer.ai";
  let granted = 0;
  for (const user of recipients) {
    const res = await grantTopup({
      userId: user.id,
      credits,
      sourceKey: `admin:${grantId}:${user.id}`,
      notify: true,
      reason,
    });
    if (res.granted > 0) {
      granted += 1;
      // Only announce grants that actually landed (granted === 0 means the
      // sourceKey already existed - a retry - and the user was told before).
      if (sendEmail) {
        await dispatchCreditGiftEmail({
          toEmail: user.email,
          locale: user.language,
          appOrigin,
          credits: res.granted,
          reason,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, count: granted });
}
