// Per-type notification visuals — icon glyph + tint — shared by the
// header bell (icon only, monochrome) and the dashboard activity widget
// (icon + colour square). Mapping by notification TYPE (the server
// `row.type`) so each event class reads distinctly: comments get a
// speech bubble, invites an envelope, a finished deck the brand purple,
// etc. Client-only toasts (errors/warnings pushed locally) have no
// server type, so both lookups fall back to the notification `kind`.

import type { NotificationKind } from "@/lib/notifications/store";

type NotificationVisual = { type?: string; flow?: string; kind: NotificationKind };

// ── Icons ────────────────────────────────────────────────────────────
// Per-flow icons for finished generations — the SAME static glyphs the
// "مشروع جديد" picker uses (see brandFlowCards), so a finished-deck
// notification reads as the flow that produced it. Keyed by the canonical
// flow (`Project.type`: create | enhance | mimic | datasheet) — the
// notification payload is normalized to this vocabulary upstream.
const FLOW_ICON: Record<string, string> = {
  create: "add_circle",
  enhance: "auto_fix_high",
  mimic: "content_copy",
  datasheet: "dataset",
};

const TYPE_ICON: Record<string, string> = {
  "comment.created": "mode_comment",
  "share.invited": "mail",
  "share.accepted": "mark_email_read",
  "deck.generate.finished": "check_circle",
  "deck.generate.failed": "error",
  "deck.regen.finished": "autorenew",
  "slide.regen.finished": "autorenew",
  "billing.credited": "account_balance_wallet",
  "billing.payment_failed": "credit_card_off",
  "billing.plan_changed": "workspace_premium",
  "account.email_changed": "alternate_email",
  "billing.subscription_ending": "event_upcoming",
  "admin.broadcast": "campaign",
};

const KIND_ICON: Record<NotificationKind, string> = {
  success: "check_circle",
  info: "info",
  warning: "warning",
  error: "error",
  promo: "campaign",
};

export function notificationIcon(n: NotificationVisual): string {
  // Finished-generation rows carry a flow → show that flow's icon.
  if (n.flow && FLOW_ICON[n.flow]) return FLOW_ICON[n.flow];
  return (n.type && TYPE_ICON[n.type]) || KIND_ICON[n.kind] || "info";
}

// ── Tints (Tailwind bg + fg) ─────────────────────────────────────────
// Generation-complete uses the BRAND purple (`--tq-violet`); the rest
// use palette hues distinct enough to tag each event class at a glance.
const TYPE_TINT: Record<string, string> = {
  "comment.created": "bg-sky-500/12 text-sky-400",
  "share.invited": "bg-teal-500/12 text-teal-400",
  "share.accepted": "bg-emerald-500/12 text-emerald-400",
  "deck.generate.finished": "bg-[var(--tq-violet)]/15 text-[var(--tq-violet)]",
  "deck.generate.failed": "bg-red-500/12 text-red-400",
  "deck.regen.finished": "bg-amber-500/12 text-amber-400",
  "slide.regen.finished": "bg-amber-500/12 text-amber-400",
  "billing.credited": "bg-emerald-500/12 text-emerald-400",
  "billing.payment_failed": "bg-red-500/12 text-red-400",
  "billing.plan_changed": "bg-emerald-500/12 text-emerald-400",
  "account.email_changed": "bg-emerald-500/12 text-emerald-400",
  "billing.subscription_ending": "bg-amber-500/12 text-amber-400",
  "admin.broadcast": "bg-indigo-500/12 text-indigo-400",
};

const KIND_TINT: Record<NotificationKind, string> = {
  success: "bg-emerald-500/12 text-emerald-400",
  info: "bg-sky-500/12 text-sky-400",
  warning: "bg-amber-500/12 text-amber-400",
  error: "bg-red-500/12 text-red-400",
  promo: "bg-violet-500/12 text-violet-400",
};

export function notificationTint(n: NotificationVisual): string {
  return (n.type && TYPE_TINT[n.type]) || KIND_TINT[n.kind] || KIND_TINT.info;
}
