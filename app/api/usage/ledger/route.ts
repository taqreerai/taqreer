// GET /api/usage/ledger — the credit "Usage" statement: how the user
// spent and received credits, newest-first, date-filtered + paginated.
//
// Auth-gated (Supabase user → Prisma user). READ-ONLY: no credits are
// mutated here. Reads the UsageEvent journal (FINAL movements only —
// holds are transient) and joins the CreditHold metadata by jobKey so
// each spend row knows its flow / preset / slide count and final charge.
//
// Query params:
//   from, to   ISO timestamps bounding createdAt (both optional → all time)
//   cursor     a UsageEvent id to page after (load-more)
//   limit      page size (default 50, max 100)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { Flow } from "@/lib/credits/cost";
import {
  STATEMENT_EVENT_TYPES,
  GRANT_EVENT_TYPES,
  type LedgerRow,
} from "@/lib/credits/usage-events";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asRecord(json: unknown): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = parseDate(sp.get("from"));
  const to = parseDate(sp.get("to"));
  const cursor = sp.get("cursor");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(sp.get("limit")) || DEFAULT_LIMIT),
  );

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  const rangeWhere = from || to ? { createdAt } : {};

  // One page of journal rows (final movements only), newest first. The
  // id tiebreak gives a stable order for cursor paging when several
  // events share a createdAt.
  const events = await prisma.usageEvent.findMany({
    where: {
      userId: dbUser.id,
      eventType: { in: [...STATEMENT_EVENT_TYPES] },
      ...rangeWhere,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      eventType: true,
      amount: true,
      metadata: true,
      createdAt: true,
    },
  });

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  // Spend rows (settle/charge) carry their job key in metadata; the rich
  // flow/preset/slides + the FINAL charge live on the matching
  // CreditHold. Batch-fetch the page's holds and join in memory.
  const jobKeys = Array.from(
    new Set(
      page
        .map((e) => {
          const m = asRecord(e.metadata);
          return (m.jobKey ?? m.chargeKey) as string | undefined;
        })
        .filter((k): k is string => typeof k === "string"),
    ),
  );

  const holds = jobKeys.length
    ? await prisma.creditHold.findMany({
        where: { userId: dbUser.id, jobKey: { in: jobKeys } },
        select: { jobKey: true, amountCharged: true, metadata: true },
      })
    : [];
  const holdByKey = new Map(holds.map((h) => [h.jobKey, h]));

  const rows: LedgerRow[] = page.map((e) => {
    const m = asRecord(e.metadata);
    const key = (m.jobKey ?? m.chargeKey) as string | undefined;
    const hold = key ? holdByKey.get(key) : undefined;
    const hm = asRecord(hold?.metadata);

    const isSpend =
      e.eventType === "credit.settle" || e.eventType === "credit.charge";

    // Spend: the final charge is authoritative on the hold (metadata.charged
    // is the fallback for a charge row or a missing hold). Otherwise the
    // signed journal amount already carries the direction (grants +, expiry -).
    let delta: number;
    if (isSpend) {
      const charged =
        typeof hold?.amountCharged === "number"
          ? hold.amountCharged
          : typeof m.charged === "number"
            ? (m.charged as number)
            : 0;
      delta = -Math.abs(charged);
    } else {
      delta = e.amount;
    }

    const slides =
      typeof hm.slides === "number"
        ? (hm.slides as number)
        : typeof hm.produced === "number"
          ? (hm.produced as number)
          : typeof hm.holdSlides === "number"
            ? (hm.holdSlides as number)
            : null;

    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      eventType: e.eventType,
      kind: (hm.kind as string | undefined) ?? null,
      flow: (hm.flow as Flow | undefined) ?? null,
      preset: (hm.preset as string | undefined) ?? null,
      slides,
      delta,
    };
  });

  // Period totals — computed over the WHOLE filtered range (not just the
  // page) and only on the first request (the client keeps them across
  // load-more). Spend is summed from settled holds (the authoritative
  // charge); grants from the journal. A job that crosses midnight can
  // skew a per-day boundary by a few seconds (hold createdAt vs settle
  // createdAt); acceptable for a usage summary.
  let totals: { spent: number; added: number } | null = null;
  if (!cursor) {
    const [spentAgg, addedAgg] = await Promise.all([
      prisma.creditHold.aggregate({
        _sum: { amountCharged: true },
        where: { userId: dbUser.id, status: "settled", ...rangeWhere },
      }),
      prisma.usageEvent.aggregate({
        _sum: { amount: true },
        where: {
          userId: dbUser.id,
          eventType: { in: [...GRANT_EVENT_TYPES] },
          ...rangeWhere,
        },
      }),
    ]);
    totals = {
      spent: spentAgg._sum.amountCharged ?? 0,
      added: Math.max(0, addedAgg._sum.amount ?? 0),
    };
  }

  return NextResponse.json({
    rows,
    totals,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  });
}
