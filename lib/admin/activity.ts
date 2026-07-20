import "server-only";

// Admin "Full activity" data layer (server-only). Two readers:
//   • getActivityUsers()        : the top-level user list (name / email /
//                                 signup country+city), mirrors the Users tab.
//   • getUserActivityTimeline() : one user's merged, paginated timeline of
//                                 generations, regens, partial regens (with the
//                                 slides that changed), failed/cancelled runs,
//                                 and exports.
//
// Everything is Prisma-only (no PostHog): exports now persist as ExportEvent
// rows. Activity hangs off Project.userId (Job has no userId), so a per-user
// query always resolves the user's projects first, then joins the rest.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { deckFlowFor, DECK_FLOW_LABEL } from "@/lib/project/flow";
import { sanitizeCity } from "@/lib/api/geo";
import type { Plan } from "@/lib/admin/mock";

const PLAN_SET = new Set<Plan>(["free", "plus", "pro", "max"]);
const asPlan = (p: string): Plan => (PLAN_SET.has(p as Plan) ? (p as Plan) : "free");

const fmt = (n: number) => n.toLocaleString("en-US");

// Compact generation duration (ms): "42s", "3m 20s", "1h 5m". Mirrors the
// helper in lib/admin/stats.ts (kept local so this module stays decoupled).
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// The canonical flow label for a deck. The brief (Project.aiPrompt JSON) carries
// source.kind ("scratch" | "enhance" | "mimic" | "data"); legacy briefs without
// it fall back to Project.type (which, post-completion, IS the flow, incl.
// "social"). deckFlowFor reads the type first (so social, which carries no
// source, is honored) then maps the source kind. DECK_FLOW_LABEL is shared.
function flowLabelFor(aiPrompt: string | null, type: string): string {
  let kind: string | undefined;
  if (aiPrompt) {
    try {
      kind = (JSON.parse(aiPrompt) as { source?: { kind?: string } })?.source
        ?.kind;
    } catch {
      /* non-JSON / legacy brief: fall back to Project.type below */
    }
  }
  return DECK_FLOW_LABEL[deckFlowFor(type, kind)] ?? "Create";
}

// ─── Top-level user list ─────────────────────────────────────────────────────

export type ActivityUser = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  country: string | null;
  city: string | null;
  joinedAt: string; // YYYY-MM-DD
};

export async function getActivityUsers(): Promise<ActivityUser[]> {
  const rows = await prisma.user.findMany({
    where: { role: { not: "admin" } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      email: true,
      plan: true,
      createdAt: true,
      signupCountry: true,
      signupCity: true,
    },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name?.trim() || u.email.split("@")[0] || "User",
    email: u.email,
    plan: asPlan(u.plan),
    country: u.signupCountry,
    // Re-sanitized on read: rows stored before the mojibake repair carry
    // double-encoded city names; the repair is idempotent for clean values.
    city: sanitizeCity(u.signupCity),
    joinedAt: u.createdAt.toISOString().slice(0, 10),
  }));
}

// ─── Per-user timeline ───────────────────────────────────────────────────────

type TimelineBase = {
  id: string;
  at: string; // ISO, the event's createdAt (also the pagination cursor)
  projectId: string | null;
  projectTitle: string | null;
};

export type TimelineItem =
  | (TimelineBase & {
      kind: "generation";
      flow: string;
      slideCount: number | null;
      cost: string;
      duration: string | null;
    })
  | (TimelineBase & {
      kind: "regen-full";
      flow: string;
      slideCount: number | null;
      cost: string;
      duration: string | null;
    })
  | (TimelineBase & {
      kind: "regen-partial";
      flow: string;
      count: number;
      slides: { position: number | null; role: string | null }[];
      cost: string;
      duration: string | null;
    })
  | (TimelineBase & {
      kind: "export";
      format: string;
      slideCount: number | null;
    })
  | (TimelineBase & {
      kind: "failed-gen";
      flow: string;
      outcome: "failed" | "cancelled";
    });

export type ActivityTimeline = { items: TimelineItem[]; nextCursor: string | null };

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export async function getUserActivityTimeline(
  userId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<ActivityTimeline> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const beforeDate = opts.before ? new Date(opts.before) : null;
  const before =
    beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
  const overscan = limit + 1;

  // 1. Resolve the user's projects: the id filter for Jobs + a flow/title map.
  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true, type: true, aiPrompt: true, title: true, slideCount: true },
  });
  const projectMeta = new Map<
    string,
    { flow: string; title: string; slideCount: number | null }
  >();
  for (const p of projects) {
    projectMeta.set(p.id, {
      flow: flowLabelFor(p.aiPrompt, p.type),
      title: p.title,
      slideCount: p.slideCount,
    });
  }
  const projectIds = projects.map((p) => p.id);

  // 2. In parallel: the earliest succeeded generation per project (for the
  //    new-vs-full-regen split, pagination-independent), the job window, and
  //    the export window.
  // An empty projectIds ⇒ `in: []` matches no rows (Prisma handles it), so the
  // job queries need no guard; exports are keyed on userId regardless.
  const [firstGens, jobs, exports] = await Promise.all([
    prisma.job.findMany({
      where: {
        projectId: { in: projectIds },
        type: "deck.generate",
        status: "succeeded",
      },
      orderBy: { createdAt: "asc" },
      distinct: ["projectId"],
      select: { id: true, projectId: true },
    }),
    prisma.job.findMany({
      where: {
        projectId: { in: projectIds },
        type: { in: ["deck.generate", "deck.regenerate.partial"] },
        // Surface completed and failed/cancelled runs; skip still-queued ones
        // so an in-flight job never occupies a window slot.
        OR: [
          { status: { in: ["succeeded", "failed"] } },
          { cancelRequestedAt: { not: null } },
        ],
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: overscan,
      select: {
        id: true,
        type: true,
        status: true,
        cancelRequestedAt: true,
        holdKey: true,
        inputJson: true,
        completedAt: true,
        createdAt: true,
        projectId: true,
      },
    }),
    prisma.exportEvent.findMany({
      where: { userId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: overscan,
      select: {
        id: true,
        projectId: true,
        format: true,
        slideCount: true,
        createdAt: true,
      },
    }),
  ]);

  const firstGenJobByProject = new Map<string, string>();
  for (const g of firstGens) {
    if (g.projectId) firstGenJobByProject.set(g.projectId, g.id);
  }

  // 3. Cost + duration for successful jobs: one CreditHold read. Full gens
  //    charge under jobKey === Job.id (holdKey null → fall back to id); partial
  //    regens store the `regen:<versionId>` key in holdKey.
  const successJobs = jobs.filter(
    (j) => j.status === "succeeded" && !j.cancelRequestedAt,
  );
  const holdKeys = successJobs.map((j) => j.holdKey ?? j.id);
  const holds = holdKeys.length
    ? await prisma.creditHold.findMany({
        where: { jobKey: { in: holdKeys }, status: "settled" },
        select: { jobKey: true, amountCharged: true, createdAt: true },
      })
    : [];
  const holdByKey = new Map(holds.map((h) => [h.jobKey, h]));

  // 4. Partial-regen slide maps: for each targeted version, slideId → position + role.
  const parseInput = (json: Prisma.JsonValue | null) => {
    const input = (json ?? {}) as { targetSlideIds?: unknown; versionId?: unknown };
    const targetSlideIds = Array.isArray(input.targetSlideIds)
      ? input.targetSlideIds.filter((s): s is string => typeof s === "string")
      : [];
    const versionId = typeof input.versionId === "string" ? input.versionId : null;
    return { targetSlideIds, versionId };
  };
  const partialVersionIds = [
    ...new Set(
      jobs
        .filter((j) => j.type === "deck.regenerate.partial")
        .map((j) => parseInput(j.inputJson).versionId)
        .filter((v): v is string => !!v),
    ),
  ];
  const versionRows = partialVersionIds.length
    ? await prisma.presentationVersion.findMany({
        where: { id: { in: partialVersionIds } },
        select: { id: true, slideJson: true },
      })
    : [];
  const slideMapByVersion = new Map<
    string,
    Map<string, { position: number; role: string | null }>
  >();
  for (const v of versionRows) {
    const slides =
      (v.slideJson as { slides?: Array<{ slideId?: string; role?: string }> })
        ?.slides ?? [];
    const m = new Map<string, { position: number; role: string | null }>();
    slides.forEach((s, idx) => {
      if (typeof s.slideId === "string") {
        m.set(s.slideId, {
          position: idx + 1,
          role: typeof s.role === "string" ? s.role : null,
        });
      }
    });
    slideMapByVersion.set(v.id, m);
  }

  // 5. Build items.
  const dated: { at: Date; item: TimelineItem }[] = [];

  for (const j of jobs) {
    if (!j.projectId) continue; // orphaned (project deleted), unattributable
    const meta = projectMeta.get(j.projectId);
    const projectTitle = meta?.title ?? null;
    const flow = meta?.flow ?? "Create";
    const at = j.createdAt;
    const base = {
      at: at.toISOString(),
      projectId: j.projectId,
      projectTitle,
    };

    // Failed / cancelled (either job type).
    if (j.status === "failed" || j.cancelRequestedAt) {
      dated.push({
        at,
        item: {
          ...base,
          id: `fail-${j.id}`,
          kind: "failed-gen",
          flow,
          outcome: j.cancelRequestedAt ? "cancelled" : "failed",
        },
      });
      continue;
    }

    // Succeeded: cost + duration from the hold.
    const hold = holdByKey.get(j.holdKey ?? j.id);
    const cost = hold ? `${fmt(hold.amountCharged ?? 0)} cr` : "Free";
    const duration =
      hold && j.completedAt
        ? formatDuration(j.completedAt.getTime() - hold.createdAt.getTime())
        : null;

    if (j.type === "deck.regenerate.partial") {
      const { targetSlideIds, versionId } = parseInput(j.inputJson);
      const vmap = versionId ? slideMapByVersion.get(versionId) : undefined;
      const slides = targetSlideIds.map((sid) => {
        const hit = vmap?.get(sid);
        return { position: hit?.position ?? null, role: hit?.role ?? null };
      });
      dated.push({
        at,
        item: {
          ...base,
          id: `regen-${j.id}`,
          kind: "regen-partial",
          flow,
          count: targetSlideIds.length,
          slides,
          cost,
          duration,
        },
      });
      continue;
    }

    // deck.generate: first succeeded generation for the project is the new
    // deck; any later one is a full regen.
    const isNew = firstGenJobByProject.get(j.projectId) === j.id;
    dated.push({
      at,
      item: {
        ...base,
        id: `gen-${j.id}`,
        kind: isNew ? "generation" : "regen-full",
        flow,
        slideCount: meta?.slideCount ?? null,
        cost,
        duration,
      },
    });
  }

  // Titles for exports of decks this user does NOT own (a shared/public deck
  // they exported): those projectIds are absent from projectMeta, so resolve
  // them in one batched read rather than rendering a titleless line.
  const foreignExportIds = [
    ...new Set(
      exports
        .map((e) => e.projectId)
        .filter((id): id is string => !!id && !projectMeta.has(id)),
    ),
  ];
  const foreignTitles = foreignExportIds.length
    ? new Map(
        (
          await prisma.project.findMany({
            where: { id: { in: foreignExportIds } },
            select: { id: true, title: true },
          })
        ).map((p) => [p.id, p.title]),
      )
    : new Map<string, string>();

  for (const e of exports) {
    const title = e.projectId
      ? (projectMeta.get(e.projectId)?.title ?? foreignTitles.get(e.projectId) ?? null)
      : null;
    dated.push({
      at: e.createdAt,
      item: {
        id: `exp-${e.id}`,
        at: e.createdAt.toISOString(),
        projectId: e.projectId,
        projectTitle: title,
        kind: "export",
        format: e.format,
        slideCount: e.slideCount,
      },
    });
  }

  // 6. Merge newest-first, slice to the page, derive the next cursor.
  dated.sort((a, b) => b.at.getTime() - a.at.getTime());
  const hasMore = dated.length > limit;
  const page = dated.slice(0, limit);
  const nextCursor = hasMore ? page[page.length - 1].item.at : null;

  return { items: page.map((d) => d.item), nextCursor };
}
