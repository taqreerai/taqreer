// GET /api/notifications
//
// Returns the current user's bell notifications, newest first. Two
// query shapes:
//   • Default          → last 50 rows for the bell dropdown +
//                         AllNotifications modal.
//   • ?ids=id1,id2,…   → fetch specific rows. Used by the realtime
//                         push handler (notification.created → fetch
//                         the row by id → push into the store) so
//                         the push wire stays pointer-only and the
//                         joined payload (actor name + avatar, project
//                         title) only flows on demand.
//
// Authorization: caller must be authenticated. There's no project
// scope here — notifications belong to the user, not a project.
//
// Response shape:
//   { notifications: NotificationRow[] }
//
// `NotificationRow` carries:
//   id, type, payload, projectId, projectTitle, actorId, actorName,
//   actorImage, createdAt (ISO), readAt (ISO|null)
//
// Joined actor + project are necessary to render the message
// ("Sara commented on slide 3 in <project title>") without a second
// round-trip per row. Cost: 1 LEFT JOIN per relation × 50 rows.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { sourceKindToFlow } from "@/lib/project/flow";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

// Notification copy is built at READ time from `type` + `payload`, so it
// follows the VIEWER's UI locale (resolved from the locale cookie in GET).
type NotifDict = Dictionary["notifications"];

const MAX_LIST = 50;
// Cap the number of ids per `?ids=` to bound the IN clause. Same
// limit the comments route uses for its parallel ?ids=.
const MAX_BY_ID = 50;

// Format a server notification row into the bell's existing
// `Notification` shape — kind / title / desc / href. Keeps the bell
// renderer untouched: it doesn't know about server types, just
// renders title + desc + click target. The client-only error /
// warning toasts that DeckView pushes via `notificationStore.push`
// continue to work because they already use the same shape.
//
// Arabic copy lives here on the server because (a) the bell is a
// Latin-digit + RTL UI, copy decisions sit best alongside the
// emit path, and (b) i18n is a single-language stack today (`ar`
// only). When we add a second language we'll thread the locale
// through the GET caller and pick a variant table.
type ActorJoin = { id: string; name: string | null; image: string | null } | null;
type ProjectJoin = { id: string; title: string } | null;

type FormattedRow = {
  id: string;
  // Raw notification type — drives per-type icon + colour on the client.
  type: string;
  // Generation flow for `deck.generate.finished` — drives the per-flow icon.
  flow?: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  desc?: string;
  href?: string;
  createdAt: string;
  read: boolean;
};

function formatActorName(actor: ActorJoin, n: NotifDict): string {
  const full = actor?.name?.trim();
  if (!full) return n.actorFallback;
  // First name only — "Osama El Khalfaoui" → "Osama".
  return full.split(/\s+/)[0];
}

// Parse a slide's 1-based deck index from its slideKey. Convention is
// `s{NN}-{semantic}` (e.g. `s05-vision` → 5) — the leading `s` plus a
// 1- or 2-digit number is set by the generator and never re-keyed
// during partial regens, so the index in the key always matches the
// deck position. Returns null for non-matching shapes so the caller
// can fall back to a count-only phrasing.
function parseSlideNumber(key: string): number | null {
  const m = key.match(/^s0*(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Render the slide-target phrase used inside notification titles:
//   1 slide  → "الشريحة 4"
//   2 slides → "الشريحتين 1 و 4"      (Arabic dual form + connector)
//   3+ slides→ "الشرائح 1، 4، 5"       (Arabic plural + comma list)
// Falls back to plain "شريحة" / "{N} شرائح" when slideKeys aren't
// parseable — keeps the row legible even if we ever change the
// slideKey convention without remembering to update this helper.
function formatSlideTarget(slideKeys: readonly string[], n: NotifDict): string {
  const nums = slideKeys
    .map(parseSlideNumber)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const s = n.slide;
  if (nums.length === 0) {
    // Unparsable keys — keep the count-based fallback.
    return slideKeys.length > 1
      ? s.count.replace("{n}", String(slideKeys.length))
      : s.one;
  }
  if (nums.length === 1) return s.slideN.replace("{n}", String(nums[0]));
  if (nums.length === 2)
    return s.slideTwo
      .replace("{a}", String(nums[0]))
      .replace("{b}", String(nums[1]));
  return s.slideMany.replace("{list}", nums.join(", "));
}

function formatNotificationRow(
  row: {
    id: string;
    type: string;
    payload: unknown;
    projectId: string | null;
    createdAt: Date;
    readAt: Date | null;
    actor: ActorJoin;
    project: ProjectJoin;
  },
  n: NotifDict,
  lang: "ar" | "en",
): FormattedRow {
  const actor = formatActorName(row.actor, n);
  const project = row.project?.title?.trim() || n.projectFallback;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  // First-write payload has `slideKey` (singular); merged payload has
  // `slideKeys` (plural, deduped). Read plural first, fall back to
  // singular wrapped in a one-element array — keeps the call site
  // below agnostic about which path produced this row.
  const slideKeys = Array.isArray(payload.slideKeys)
    ? payload.slideKeys.filter((s): s is string => typeof s === "string")
    : typeof payload.slideKey === "string"
      ? [payload.slideKey]
      : [];
  const slideTarget = formatSlideTarget(slideKeys, n);
  const isProject = row.projectId != null;

  let kind: FormattedRow["kind"] = "info";
  let title: string;
  let desc: string | undefined;
  let href: string | undefined;
  // Set only for deck.generate.finished — the generation flow kind.
  let flow: string | undefined;

  // 2026-05-26 — all notification copy unified to PASSIVE / verbal-noun
  // forms so the phrasing works for both male AND female actors. The
  // previous mix (masculine علّق/أعاد + feminine قبلت) read wrong for
  // half the userbase. New shape: "تم {verb} ... من طرف {actor} ...".
  switch (row.type) {
    case "comment.created":
      // Title carries the actual slide NUMBER(s) so the recipient sees
      // WHICH slide the actor touched.
      title = n.comment.title;
      desc = n.comment.desc
        .replace("{target}", slideTarget)
        .replace("{actor}", actor)
        .replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    // `*.started` cases dropped 2026-05-27 — those notifications are
    // no longer persisted server-side (see lib/notifications/server.ts
    // for the rationale). The default branch will safely format any
    // stale `*.started` rows still living in the DB until the cleanup
    // migration drops them.
    case "slide.regen.finished":
      title = n.slideRegen.title;
      desc = n.slideRegen.desc
        .replace("{target}", slideTarget)
        .replace("{actor}", actor)
        .replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "deck.regen.finished": {
      const count =
        typeof payload.count === "number" && payload.count > 1
          ? payload.count
          : 1;
      title = n.deckRegen.title;
      desc =
        count > 1
          ? n.deckRegen.descMany
              .replace("{count}", String(count))
              .replace("{actor}", actor)
              .replace("{project}", project)
          : n.deckRegen.descOnce
              .replace("{actor}", actor)
              .replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    }
    case "deck.generate.finished": {
      kind = "success";
      // Flow-specific copy + icon. `sourceKindToFlow` normalizes the
      // payload to the canonical flow, so this handles both new payloads
      // (already canonical) and older raw ones (scratch | data).
      flow = sourceKindToFlow(
        typeof payload.kind === "string" ? payload.kind : undefined,
      );
      title =
        n.finished[flow as keyof typeof n.finished] ?? n.finished.fallback;
      desc = n.generate.desc.replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    }
    case "deck.generate.failed":
      kind = "error";
      title = n.generateFailed.title;
      desc =
        typeof payload.reason === "string" && payload.reason
          ? payload.reason
          : n.generateFailed.desc.replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "share.invited": {
      const level = typeof payload.accessLevel === "string" ? payload.accessLevel : null;
      const role =
        level === "edit"
          ? n.share.roleEdit
          : level === "comment"
            ? n.share.roleComment
            : n.share.roleView;
      // Lead with the action (passive, gender-neutral) so the recipient
      // reads what happened before the inviter's name.
      title = n.share.invitedTitle;
      desc = n.share.invitedDesc
        .replace("{actor}", actor)
        .replace("{project}", project)
        .replace("{role}", role);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    }
    case "share.accepted":
      kind = "success";
      title = n.share.acceptedTitle;
      desc = n.share.acceptedDesc
        .replace("{actor}", actor)
        .replace("{project}", project);
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "billing.credited": {
      kind = "success";
      const credits =
        typeof payload.credits === "number" ? payload.credits : 0;
      const reason =
        payload.reason === "topup" || payload.reason === "welcome"
          ? payload.reason
          : "renewal";
      title = n.billing.creditedTitle.replace(
        "{credits}",
        credits.toLocaleString("en-US"),
      );
      desc = n.billing[
        reason === "topup"
          ? "creditedTopup"
          : reason === "welcome"
            ? "creditedWelcome"
            : "creditedRenewal"
      ];
      href = "/plans";
      break;
    }
    case "billing.payment_failed":
      kind = "error";
      title = n.billing.paymentFailedTitle;
      desc = n.billing.paymentFailedDesc;
      // The page with payment methods (embedded billing, 2026-06-12).
      href = "/billing";
      break;
    case "billing.subscription_ending": {
      kind = "warning";
      const date =
        typeof payload.date === "string" ? payload.date : "";
      title = n.billing.endingTitle.replace("{date}", date);
      desc = n.billing.endingDesc;
      // Resume lives on /billing.
      href = "/billing";
      break;
    }
    case "billing.plan_changed": {
      kind = "success";
      const planKey = typeof payload.plan === "string" ? payload.plan : "";
      // Tier labels are the SAME Latin names in both locales.
      const planName = planKey.charAt(0).toUpperCase() + planKey.slice(1);
      const credits =
        typeof payload.credits === "number" ? payload.credits : 0;
      title = n.billing.planChangedTitle.replace("{plan}", planName);
      desc = n.billing.planChangedDesc.replace(
        "{credits}",
        credits.toLocaleString("en-US"),
      );
      href = "/plans";
      break;
    }
    case "account.email_changed": {
      kind = "success";
      const email = typeof payload.email === "string" ? payload.email : "";
      title = n.account.emailChangedTitle;
      desc = n.account.emailChangedDesc.replace("{email}", email);
      href = "/settings";
      break;
    }
    case "admin.broadcast": {
      // Bilingual announcement: render the VIEWER's locale version verbatim
      // (no template, no actor/project, not a link target).
      const side = payload[lang] as
        | { title?: unknown; message?: unknown }
        | undefined;
      title = typeof side?.title === "string" ? side.title : "";
      desc = typeof side?.message === "string" ? side.message : undefined;
      break;
    }
    default:
      // Unknown type — surface a generic row using payload.title if
      // present (forward-compat for types deployed server-side ahead
      // of a client release).
      title =
        typeof payload.title === "string" && payload.title
          ? payload.title
          : `${actor} ${project}`;
      desc =
        typeof payload.desc === "string" ? payload.desc : undefined;
      break;
  }

  return {
    id: row.id,
    type: row.type,
    flow: flow || undefined,
    kind,
    title,
    desc,
    href,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt != null,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Notification copy follows the VIEWER's UI locale (this GET is the
  // recipient reading their own bell), resolved from the locale cookie.
  const cookieStore = await cookies();
  const localeRaw = cookieStore.get(LOCALE_COOKIE)?.value;
  const lang = isLocale(localeRaw) ? localeRaw : "ar";
  const dict = await getDictionary(lang);
  const n = dict.notifications;
  // Resolve Prisma user — the notification table FKs on Prisma id,
  // not Supabase auth id. User-sync race tolerance: if the Prisma row
  // hasn't been provisioned yet (first login → row hasn't landed),
  // return an empty list rather than 500. The bell handles empty
  // gracefully; the row will exist by the time the user does anything
  // that creates a notification anyway.
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: data.user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ notifications: [] });
  }

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  let where: { recipientUserId: string; id?: { in: string[] } };
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_BY_ID);
    if (ids.length === 0) {
      return NextResponse.json({ notifications: [] });
    }
    where = { recipientUserId: dbUser.id, id: { in: ids } };
  } else {
    where = { recipientUserId: dbUser.id };
  }

  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: idsParam ? MAX_BY_ID : MAX_LIST,
    select: {
      id: true,
      type: true,
      payload: true,
      projectId: true,
      actorUserId: true,
      createdAt: true,
      readAt: true,
      // Actor (nullable — null when system-generated or actor was
      // deleted). Email omitted — same PII reasoning as the comments
      // route's `select: { id, name, image }`.
      actor: {
        select: { id: true, name: true, image: true },
      },
      // Project (nullable — null when the row was account-scoped or
      // the project was deleted). Title is the only field the
      // renderer needs.
      project: {
        select: { id: true, title: true },
      },
    },
  });

  const notifications = rows.map((r) => formatNotificationRow(r, n, lang));

  return NextResponse.json({ notifications });
}
