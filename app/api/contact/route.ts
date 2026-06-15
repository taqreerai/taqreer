// POST /api/contact - PUBLIC contact-form endpoint (anonymous; people must be
// able to reach us pre-launch). Guards: honeypot, field validation, per-IP rate
// limit. Routing is server-side (DEPARTMENT_EMAILS), so the client never names a
// destination address (no open relay).

import { NextResponse } from "next/server";
import {
  DEPARTMENT_EMAILS,
  DEPARTMENT_LABELS_EN,
  isDepartment,
} from "@/lib/contact/departments";
import { sendContact } from "@/lib/email/send-contact";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";

// Same shape as the share-invite validator: a pragmatic RFC-5322-ish check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  // ── Rate limit (5 / 10 min per IP) ──────────────────────────────────────
  const limited = rateLimited(`contact:${clientIp(request)}`, 5, 10 * 60_000);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;

  // ── Honeypot: a hidden field bots fill. If present, pretend success and
  // drop silently (don't tip off the bot, don't send). ───────────────────
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // ── Validate ────────────────────────────────────────────────────────────
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const department = body.department;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (name.length < 1 || name.length > 100) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!isDepartment(department)) {
    return NextResponse.json({ error: "invalid_department" }, { status: 400 });
  }
  if (message.length < 10 || message.length > 4000) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }

  const result = await sendContact({
    toEmail: DEPARTMENT_EMAILS[department],
    departmentLabel: DEPARTMENT_LABELS_EN[department],
    fromName: name,
    fromEmail: email,
    message,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
