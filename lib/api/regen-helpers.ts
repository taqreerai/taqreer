// Shared helpers for the two regen routes that allocate a new
// `PresentationVersion` and dispatch a `deck.regenerate.partial.requested`
// Inngest event:
//
//   • POST /api/projects/[id]/slides/[slideKey]/regen  — per-slide pill
//   • POST /api/projects/[id]/regenerate-partial       — apply-drafts batch
//
// Both routes used to carry near-identical:
//   1. `allocateNextVersion` P2002-retry version-seeding helper
//   2. `rollbackVersionAndJob` failure-path cleanup
//
// Lifted here (2026-05-27 simplifier pass) so the two routes can keep
// their orchestration short and the shared logic stays in one place.

import { FREE_AI_EDIT_LOCK, FREE_PLAN_FEATURE_LOCKS } from "@/lib/free-trial";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBalance } from "@/lib/credits/server";
import { normalizePlan } from "@/lib/plan";

/**
 * Convert `unknown` to `Prisma.InputJsonValue` via a JSON round-trip.
 * Defensive narrowing for `slideJson` passthroughs where the value
 * came from a previous version's column — undefined → null, dates →
 * ISO strings, circular refs throw before they reach Prisma.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Allocate a new `PresentationVersion` inside an existing Prisma
 * transaction. Seeds `slideJson` from the latest version's manifest
 * so partial regen can splice updated slides into a complete deck
 * (NOT a blank `{ status: "queued", slides: [] }` — that would
 * blank the deck mid-stream). Status starts as `"queued"`.
 *
 * The (presentationId, versionNumber) pair has a unique index;
 * concurrent regens can race on `nextNumber`. Caller wraps the
 * containing call in `retryOnP2002` to recover from the resulting
 * collision.
 *
 * `tx`-scoped (not a free `prisma` call) because both call sites
 * embed this in a larger transaction:
 *   - file 7 (slides/[slideKey]/regen) wraps just this step
 *   - file 9 (regenerate-partial) wraps this PLUS draft promotion
 */
export async function allocateNextVersionInTx(
  tx: Prisma.TransactionClient,
  presentationId: string,
  // The version the CALLER builds the new manifest from. The GeneratedImage
  // row copy below must read the SAME version — copying from the highest
  // versionNumber instead could pair the new manifest with another
  // concurrent version's rows (CR PR #185). Optional for callers that
  // genuinely mean "whatever is latest".
  sourceVersionId?: string,
): Promise<{ id: string; versionNumber: number }> {
  const latest = await tx.presentationVersion.findFirst({
    where: { presentationId },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, slideJson: true },
  });
  const nextNumber = (latest?.versionNumber ?? 0) + 1;
  const created = await tx.presentationVersion.create({
    data: {
      presentationId,
      versionNumber: nextNumber,
      status: "queued",
      slideJson: toJson(latest?.slideJson ?? { status: "queued", slides: [] }),
    },
    select: { id: true, versionNumber: true },
  });
  // Carry the GeneratedImage rows forward with the manifest they annotate.
  // The rows are keyed to the VERSION, so without this every partial regen
  // orphaned them on the old version: failed boxes lost their retry overlay
  // (the status route reads the latest version's rows) and the per-image
  // regen route lost its row — the box degraded to an eternal loading
  // shimmer (incident 2026-08-05). `generating` is copied as `pending` so
  // an in-flight claim on the OLD version's row can't wedge the new one:
  // pending is re-claimable by every fill path, generating is not.
  const copyFromId = sourceVersionId ?? latest?.id;
  if (copyFromId) {
    const rows = await tx.generatedImage.findMany({
      // The relation guard pins the source to THIS presentation, so a
      // caller bug can never graft another deck's rows onto the version.
      where: {
        presentationVersionId: copyFromId,
        version: { presentationId },
      },
      select: {
        slideKey: true,
        genid: true,
        prompt: true,
        role: true,
        aspect: true,
        size: true,
        status: true,
        storageUrl: true,
      },
    });
    if (rows.length > 0) {
      await tx.generatedImage.createMany({
        data: rows.map((r) => ({
          ...r,
          status: r.status === "generating" ? "pending" : r.status,
          presentationVersionId: created.id,
        })),
      });
    }
  }
  return created;
}

/**
 * Retry an operation on Prisma's P2002 unique-constraint violation.
 * Used to recover from the (presentationId, versionNumber) race when
 * two regen requests land concurrently. Re-throws non-P2002 errors
 * immediately and re-throws the last P2002 after exhausting attempts.
 */
export async function retryOnP2002<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002" || attempt === maxAttempts - 1) throw err;
    }
  }
  throw lastError;
}

/**
 * Best-effort rollback for the Inngest-dispatch failure path on both
 * regen routes. Flips the newly-allocated version + the regen Job
 * (if it got created before the failure) to `"failed"` so the user
 * sees a real failed state instead of an indefinite "queued". Both
 * writes run in parallel; per-row blips are swallowed uniformly
 * (the version row may have been deleted concurrently; the job row
 * may not have been created if Job.create itself was the failure
 * point). Caller threads `jobId: null` when Job.create didn't run.
 */
export async function rollbackVersionAndJob(args: {
  versionId: string;
  jobId: string | null;
}): Promise<void> {
  const { versionId, jobId } = args;
  const writes: Promise<unknown>[] = [
    prisma.presentationVersion.update({
      where: { id: versionId },
      data: { status: "failed" },
    }),
  ];
  if (jobId) {
    writes.push(
      prisma.job.update({
        where: { id: jobId },
        data: { status: "failed" },
      }),
    );
  }
  await Promise.allSettled(writes);
}

// Re-export Prisma's transaction-client type alias so call sites
// don't all need to import it themselves.
export type RegenTx = Prisma.TransactionClient;

// The 402 body a regen route returns when the deck OWNER can't afford the run.
// Structurally matches `CreditGatePayload` in
// components/credits/CreditGateDialog.tsx (validated there by `isCreditGatePayload`),
// so the studio opens the SAME UpgradeModal / top-up flow the generation flows use
// off the /api/projects 402. A regen has no reduce-slides offer, so those option
// fields stay null/empty and only `topupGap` (needs − have) is populated.
export type CreditGate402 = {
  error: "insufficient_credits" | "ai_edit_locked";
  balance: number;
  slideCap: null;
  minFlowTier: string | null;
  options: {
    reducedSlides: null;
    reducedCredits: null;
    cheaperPresets: string[];
    topupGap: number;
  };
};

/**
 * Pre-flight credit gate for the regen routes. The regen/generate workers hold
 * credits against the deck OWNER (project.userId) and throw NonRetriableError
 * when the balance can't cover it, which the user only ever sees as a generic
 * `failed` version with no upgrade path (the incident this fixes). This runs the
 * SAME balance check in the ROUTE, BEFORE any version/job is allocated or event
 * dispatched, so the studio can open the credit gate synchronously instead.
 *
 * Returns the 402 body to send, or null when the run is affordable (or the owner
 * is an admin, whose runs are waived downstream by holdCredits, mirroring the
 * isAdmin bypass in preflightGenerate). `cost` MUST be computed with the same
 * call the worker holds with (regenCost for partial/slide regen, the carried
 * generation holdCredits for full-deck regen) so shown == charged. The worker
 * hold stays the authoritative backstop; this is the UX-forward gate.
 */
export async function regenCreditGate(args: {
  ownerId: string;
  ownerRole: string;
  // The deck owner's plan: AI edits after generation are a paid feature
  // (2026-10-02), so a Free owner's regen is refused before any cost check.
  ownerPlan: string | null | undefined;
  cost: number;
  // false = not an AI edit (the full-deck regenerate, which also serves Retry
  // on a failed generation): skip the free-plan AI-edit lock.
  aiEdit?: boolean;
}): Promise<CreditGate402 | null> {
  if (args.ownerRole === "admin") return null;
  if (
    (FREE_PLAN_FEATURE_LOCKS || (FREE_AI_EDIT_LOCK && args.aiEdit !== false)) &&
    normalizePlan(args.ownerPlan) === "free"
  ) {
    return {
      error: "ai_edit_locked",
      balance: 0,
      slideCap: null,
      minFlowTier: "plus",
      options: { reducedSlides: null, reducedCredits: null, cheaperPresets: [], topupGap: 0 },
    };
  }
  if (args.cost <= 0) return null;
  const balance = await getBalance(args.ownerId);
  if (args.cost <= balance.total) return null;
  return {
    error: "insufficient_credits",
    balance: balance.total,
    slideCap: null,
    minFlowTier: null,
    options: {
      reducedSlides: null,
      reducedCredits: null,
      cheaperPresets: [],
      topupGap: args.cost - balance.total,
    },
  };
}
