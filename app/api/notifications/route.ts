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
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

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
  kind: "info" | "success" | "warning" | "error";
  title: string;
  desc?: string;
  href?: string;
  createdAt: string;
  read: boolean;
};

function formatActorName(actor: ActorJoin): string {
  return actor?.name?.trim() || "أحد المتعاونين";
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
function formatSlideTarget(slideKeys: readonly string[]): string {
  const nums = slideKeys
    .map(parseSlideNumber)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (nums.length === 0) {
    // Unparsable keys — keep the count-based fallback.
    return slideKeys.length > 1 ? `${slideKeys.length} شرائح` : "شريحة";
  }
  if (nums.length === 1) return `الشريحة ${nums[0]}`;
  if (nums.length === 2) return `الشريحتين ${nums[0]} و ${nums[1]}`;
  return `الشرائح ${nums.join("، ")}`;
}

function formatNotificationRow(row: {
  id: string;
  type: string;
  payload: unknown;
  projectId: string | null;
  createdAt: Date;
  readAt: Date | null;
  actor: ActorJoin;
  project: ProjectJoin;
}): FormattedRow {
  const actor = formatActorName(row.actor);
  const project = row.project?.title?.trim() || "أحد العروض";
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
  const slideTarget = formatSlideTarget(slideKeys);
  const isProject = row.projectId != null;

  let kind: FormattedRow["kind"] = "info";
  let title: string;
  let desc: string | undefined;
  let href: string | undefined;

  switch (row.type) {
    case "comment.created":
      // Title carries the actual slide NUMBER(s) — e.g.
      // "{actor} علّق على الشريحة 4 في {project}" — instead of the
      // count-only phrasing ("علّق على شريحة"). Per user request
      // 2026-05-24 during PR #33 testing: the bell row should make
      // it obvious WHICH slide the actor touched, so the recipient
      // can decide whether to click through.
      title = `${actor} علّق على ${slideTarget} في ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "slide.regen.started":
      // Mid-flight signal — peer sees "X is redesigning slide N" the
      // moment the regen kicks off, paired with a live spinner overlay
      // on the affected slide. The `.finished` row lands separately
      // when the regen completes (different type, so they don't merge).
      // Re-added 2026-05-24 after user requested the live spinner
      // back for partial regens (was scrapped earlier as too noisy).
      title = `${actor} يعيد تصميم ${slideTarget} في ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "slide.regen.finished":
      // Same shape as comment.created — include the slide number(s)
      // so the recipient sees which slide was redesigned.
      title = `${actor} أعاد تصميم ${slideTarget} في ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "deck.regen.started":
      // Mid-flight signal for full deck regen. Peer sees this notification
      // and a global "deck mid-regen" banner over the slides (DeckView
      // marks every slide in the manifest as in-flight). The `.finished`
      // row arrives separately when the regen completes.
      title = `${actor} يعيد تصميم العرض كاملاً في ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    case "deck.regen.finished": {
      const count =
        typeof payload.count === "number" && payload.count > 1
          ? payload.count
          : 1;
      title =
        count > 1
          ? `${actor} أعاد تصميم العرض ${count} مرات في ${project}`
          : `${actor} أعاد تصميم العرض كاملاً في ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    }
    case "deck.generate.finished":
      kind = "success";
      title = `اكتمل توليد ${project}`;
      desc = "اضغط لفتح المعاينة.";
      href = isProject ? `/preview/${row.projectId}` : undefined;
      break;
    case "deck.generate.failed":
      kind = "error";
      title = `فشل توليد ${project}`;
      desc =
        typeof payload.reason === "string" && payload.reason
          ? payload.reason
          : "حاول مرة أخرى من صفحة المعاينة.";
      href = isProject ? `/preview/${row.projectId}` : undefined;
      break;
    case "share.invited": {
      const level = typeof payload.accessLevel === "string" ? payload.accessLevel : null;
      const roleAr =
        level === "edit" ? "للتعديل" : level === "comment" ? "للتعليق" : "للعرض";
      title = `${actor} دعتك للانضمام إلى ${project} ${roleAr}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
    }
    case "share.accepted":
      kind = "success";
      title = `${actor} قبلت دعوتك للانضمام إلى ${project}`;
      href = isProject ? `/project/${row.projectId}` : undefined;
      break;
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

  const notifications = rows.map(formatNotificationRow);

  return NextResponse.json({ notifications });
}
