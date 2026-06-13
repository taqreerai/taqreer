// Email-lab HTML sender. Delivers raw pasted HTML to a FIXED inbox
// (dev@taqreer.ai) so the rendered look (CSS gradients, iOS dark mode, ...) can
// be checked in a real email client while iterating on the markup. The
// recipient is hardcoded, so this can't be used to email anyone else.
//
// Gated: open on localhost (NODE_ENV !== production); owner-only on prod.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

const RECIPIENT = "dev@taqreer.ai";

export async function POST(req: NextRequest) {
  // On prod, only the owner account may trigger a send.
  if (process.env.NODE_ENV === "production") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email !== RECIPIENT) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as {
    html?: string;
    subject?: string;
  } | null;
  const html = String(body?.html ?? "");
  const subject = String(body?.subject ?? "").trim() || "taqreer.ai email test";

  if (!html.trim()) {
    return NextResponse.json(
      { ok: false, error: "Paste some HTML first." },
      { status: 400 },
    );
  }

  const from = process.env.RESEND_FROM_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !from) {
    return NextResponse.json(
      { ok: false, error: "Resend not configured in this environment." },
      { status: 500 },
    );
  }

  try {
    const resend = new Resend(apiKey);
    const res = await resend.emails.send({ from, to: RECIPIENT, subject, html });
    if (res.error) {
      return NextResponse.json(
        { ok: false, error: res.error.message },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, to: RECIPIENT, id: res.data?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    console.error("[email-lab] send failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
