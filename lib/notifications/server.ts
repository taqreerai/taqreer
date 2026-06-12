// Server-side fan-out for the bell notifications. One row per
// (recipient, event); the bell reads them via REST and a per-user
// Supabase channel pushes new ones live (see `lib/realtime/user-
// channel.ts` + `broadcastToUser` in `server-broadcast.ts`).
//
// Call sites are paired with the existing broadcast emission points
// — `POST /api/projects/[id]/comments`, slide/deck regen finished
// steps, share invite/accept routes, etc. The two systems sit side-
// by-side: the project channel pushes "live UI" events (canvas
// swap, lock pill flip), the user channel pushes "should this land
// in your bell" events. Both fire from the same server-side action
// so observers either see live updates AND a bell entry, or neither.
//
// Grouping (per product decision 2026-05-24):
//   When the same (recipient, type, projectId, actor) fires twice
//   within `GROUP_WINDOW_MS`, we MERGE into the existing row rather
//   than spamming the bell. Merge bumps `createdAt`, clears `readAt`,
//   and combines the payload's `slideKeys` array so the renderer can
//   flip to a count form ("X commented on 3 slides"). Types that
//   don't carry per-slide context (`deck.regen.finished`,
//   `share.*`) still group on the tuple but the merged payload just
//   bumps a counter.
//
// Failure mode:
//   Each recipient's row is independent. If a write fails for one
//   recipient we log + continue — partial fan-out is better than
//   none. The triggering action (comment write, regen complete, etc.)
//   is NEVER blocked on this helper: every callsite invokes it as
//   fire-and-forget. The broadcast helper is also fire-and-forget
//   for the same reason.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcastToUser } from "@/lib/realtime/server-broadcast";
import type { BrandKitTargetFlow } from "@/lib/create/seed-from-brand-kit";

// Active notification types. Adding a new type here is the place to
// update — the bell renderer's lookup table is the only other site
// that needs to know the type's existence (unknown types fall back to
// a generic info row, so deploys can ship server-side ahead of
// client-side without surfacing errors).
// `*.started` events (slide.regen.started, deck.regen.started) used to
// be persisted here too, but were dropped 2026-05-27 — they're transient
// live-UI signals (spinners, banners), and by the time the recipient
// opens the bell the regen has already finished. Persisting them only
// doubled the badge count for a single logical regen. The terminal
// `*.finished` row carries enough information on its own.
export type NotificationType =
  | "comment.created"
  | "slide.regen.finished"
  | "deck.regen.finished"
  | "deck.generate.finished"
  | "deck.generate.failed"
  | "share.invited"
  | "share.accepted"
  // Billing (Phase B) - account-scoped, no project. Fanned out to the
  // single recipient via recipientUserIds.
  | "billing.credited"
  | "billing.payment_failed"
  | "billing.subscription_ending"
  // A subscription purchase/upgrade activated a (new) plan.
  | "billing.plan_changed"
  // Account-scoped: the user's email change was confirmed (sole
  // recipient = the user, allowSelfEcho).
  | "account.email_changed";

// Per-type payload contracts. The DB column is `Json` (no schema
// enforcement at the DB layer) — these are the *intended* shapes
// callers + renderers agree on. New fields are additive; never
// remove a field a deployed renderer depends on.
export type NotificationPayloadMap = {
  "comment.created": {
    commentId: string;
    slideKey: string;
    // Populated by the merge path. Always includes the latest
    // slideKey; ordered oldest → newest. Reader uses
    // `slideKeys.length` to decide the count form.
    slideKeys?: string[];
  };
  "slide.regen.finished": {
    slideKey: string;
    slideKeys?: string[];
  };
  "deck.regen.finished": {
    // No extra fields — the project context is enough. Reader uses
    // `count` (set on merge) for the bumped form.
    count?: number;
  };
  "deck.generate.finished": {
    versionId: string;
    // Canonical generation flow (create | enhance | mimic | datasheet) —
    // drives the flow-specific notification title. The emit site normalizes
    // the raw source kind via `sourceKindToFlow`, so this is already the
    // flow vocabulary, not the source-kind one.
    kind?: BrandKitTargetFlow;
  };
  "deck.generate.failed": {
    reason?: string;
  };
  "share.invited": {
    accessLevel: "view" | "comment" | "edit";
  };
  "share.accepted": {
    accessLevel: "view" | "comment" | "edit";
  };
  "billing.credited": {
    credits: number;
    // What put credits in: a renewal/upgrade, a top-up pack, or the
    // free signup gift - drives the row's sub-line.
    reason: "renewal" | "topup" | "welcome";
  };
  "billing.payment_failed": Record<string, never>;
  "billing.plan_changed": {
    // Tier key ("plus" | "pro" | "max") - reader renders the Latin label.
    plan: string;
    // The monthly allotment granted with the activation.
    credits: number;
  };
  "account.email_changed": {
    // The NEW address, post-confirmation.
    email: string;
  };
  "billing.subscription_ending": {
    // ISO date the access ends (period end). Rendered Latin-digit.
    date: string;
  };
};

// Group window for the merge path. 10 minutes covers the realistic
// "Sara is editing rapidly" burst without merging across genuinely
// distinct sessions (someone coming back to comment hours later
// should produce a fresh row).
const GROUP_WINDOW_MS = 10 * 60 * 1000;

// Types that the grouping path applies to. Per-event types like
// `deck.generate.finished` or `share.invited` are 1:1 by nature
// (a deck only finishes generating once; an invite is sent at one
// moment) — grouping them would mask information rather than
// reduce noise.
// Grouping disabled entirely (user direction 2026-05-24): "let's just
// get rid of merging entirely i dont think we need it, things need to
// be accurate." Earlier design grouped same-type events from the same
// actor within a 10-minute window into one row so the bell didn't fill
// with near-identical lines (5 comments in 2 min → 1 row reading
// "X commented on slides 1, 3, 5"). In practice the merged copy read
// as imprecise — "X redesigned slides 1 AND 3" implies one combined
// action when really two separate regens fired, and the user couldn't
// tell when each finished from the bell alone. Each event now stands
// on its own row; the noise trade-off is worth the accuracy.
//
// `GROUPABLE_TYPES` and the merge path below are retained as dead code
// because (a) the user may change their mind, (b) the merge logic is
// non-trivial to recreate, and (c) flipping the Set's contents is a
// one-line revert. New types added in the meantime should default to
// non-groupable; only re-add an entry here if there's a clear noise
// problem that grouping uniquely solves.
const GROUPABLE_TYPES = new Set<NotificationType>();

type FanOutInput<T extends NotificationType> = {
  type: T;
  // Null for account-scoped events (billing.*) that carry an explicit
  // `recipientUserIds` instead of resolving from project membership.
  projectId: string | null;
  // Prisma user id of the actor (the user whose action triggered
  // the event). Excluded from the recipient set via self-echo skip.
  // Pass null for system-generated events (`deck.generate.*`) so
  // the fan-out doesn't accidentally exclude anyone.
  actorPrismaUserId: string | null;
  payload: NotificationPayloadMap[T];
  // Optional override of the recipient set. When passed, ONLY these
  // users receive the notification (used by `share.invited` where
  // the invitee is the sole recipient, not the project's existing
  // members). Still self-echo skipped against `actorPrismaUserId`
  // unless `allowSelfEcho` is set.
  recipientUserIds?: string[];
  // Disables the self-echo filter. Used by `deck.generate.finished`
  // where the actor IS the intended recipient: they kicked off the
  // generation and need to be told it landed, even if they're the
  // same user. Defaults to false to preserve the safe default
  // (you don't get notified about your own actions).
  allowSelfEcho?: boolean;
};

// Project members are: the owner + every share row with an accepted
// invitee (acceptedAt != null AND userId != null — pending invites
// have no userId yet). Pulled in one query so the fan-out path
// stays a single round trip per event.
async function resolveProjectMembers(
  projectId: string,
): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      userId: true,
      shares: {
        where: {
          acceptedAt: { not: null },
          userId: { not: null },
        },
        select: { userId: true },
      },
    },
  });
  if (!project) return [];
  const ids = new Set<string>([project.userId]);
  for (const s of project.shares) {
    if (s.userId) ids.add(s.userId);
  }
  return [...ids];
}

// Merge a fresh payload into an existing one for a groupable type.
// The merge is type-specific because each type carries different
// per-event info (slideKey, etc.). Always returns a Json-safe value.
function mergePayload<T extends NotificationType>(
  type: T,
  existing: unknown,
  incoming: NotificationPayloadMap[T],
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  switch (type) {
    case "comment.created":
    case "slide.regen.finished": {
      const slideKey = (incoming as { slideKey?: string }).slideKey;
      const existingKeys = Array.isArray(base.slideKeys)
        ? base.slideKeys.filter((k): k is string => typeof k === "string")
        : typeof base.slideKey === "string"
          ? [base.slideKey]
          : [];
      // Dedupe — if the actor edits the SAME slide twice we don't
      // want the count form to inflate. Keep insertion order so the
      // renderer can show "latest first" if it wants.
      const slideKeys = slideKey && !existingKeys.includes(slideKey)
        ? [...existingKeys, slideKey]
        : existingKeys.length > 0
          ? existingKeys
          : slideKey
            ? [slideKey]
            : [];
      return {
        ...base,
        ...(incoming as Record<string, unknown>),
        slideKeys,
      };
    }
    case "deck.regen.finished": {
      const prevCount = typeof base.count === "number" ? base.count : 1;
      return { ...base, ...(incoming as Record<string, unknown>), count: prevCount + 1 };
    }
    default:
      // Shouldn't reach here — GROUPABLE_TYPES is the gate above.
      return { ...base, ...(incoming as Record<string, unknown>) };
  }
}

/**
 * Fan-out a notification to every project member except the actor,
 * with optional grouping into a recent row of the same shape.
 *
 * Fire-and-forget at every callsite. Never throws — failures log and
 * the loop continues so a single recipient's write blip doesn't
 * skip the rest.
 */
export async function fanOutNotification<T extends NotificationType>(
  input: FanOutInput<T>,
): Promise<void> {
  const {
    type,
    projectId,
    actorPrismaUserId,
    payload,
    recipientUserIds,
    allowSelfEcho,
  } = input;

  // Resolve recipients: caller override OR project membership.
  let recipients =
    recipientUserIds ??
    (projectId ? await resolveProjectMembers(projectId) : []);
  // Self-echo skip — the actor doesn't need to be told they did the
  // thing. Skipped even when `recipientUserIds` is an override (a
  // share-accepted notification to the owner won't fire if the owner
  // somehow accepted their own invite — defensive). Opt-out via
  // `allowSelfEcho` for events like `deck.generate.finished` where
  // the actor is the intended recipient.
  if (actorPrismaUserId && !allowSelfEcho) {
    recipients = recipients.filter((id) => id !== actorPrismaUserId);
  }
  if (recipients.length === 0) return;

  const groupable = GROUPABLE_TYPES.has(type);
  const since = new Date(Date.now() - GROUP_WINDOW_MS);

  // Process recipients sequentially so each one's group check sees
  // its own freshly-merged row (relevant when bulk events fire in
  // parallel, e.g. lock-all + per-slide events — though only one
  // event type at a time hits this helper today). Bulk-create would
  // skip the group path entirely; correctness > the single extra
  // round-trip.
  for (const recipientId of recipients) {
    try {
      let notificationId: string | null = null;

      if (groupable) {
        const existing = await prisma.notification.findFirst({
          where: {
            recipientUserId: recipientId,
            type,
            projectId,
            actorUserId: actorPrismaUserId,
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, payload: true },
        });
        if (existing) {
          const merged = mergePayload(type, existing.payload, payload);
          await prisma.notification.update({
            where: { id: existing.id },
            data: {
              payload: merged as Prisma.InputJsonValue,
              // Bump to "now" so the merged row floats to the top of
              // the bell's createdAt-desc list.
              createdAt: new Date(),
              // Re-unread on merge so the user sees the latest activity
              // even if they had already read the prior row.
              readAt: null,
            },
          });
          notificationId = existing.id;
        }
      }

      if (!notificationId) {
        const created = await prisma.notification.create({
          data: {
            recipientUserId: recipientId,
            type,
            payload: payload as Prisma.InputJsonValue,
            projectId,
            actorUserId: actorPrismaUserId,
          },
          select: { id: true },
        });
        notificationId = created.id;
      }

      // Broadcast on the recipient's user channel. Pointer-only —
      // the bell fetches the full row by id via REST. Fire-and-forget;
      // a missed broadcast just means the user sees the notification
      // on next bell open / next refresh / visibility-regain refetch.
      broadcastToUser(recipientId, "notification.created", {
        notificationId,
      }).catch((err) => {
        console.warn("[notifications] user broadcast failed", {
          recipientId,
          type,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (err) {
      // Per-recipient failure isolation — log + continue. The next
      // recipient still gets their row.
      console.warn("[notifications] fanOut row failed", {
        recipientId,
        type,
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
