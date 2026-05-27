// Shared helpers for the two regen routes that allocate a new
// `PresentationVersion` and dispatch a `deck.regenerate.partial.requested`
// Inngest event:
//
//   • POST /api/projects/[id]/slides/[slideKey]/regen  — per-slide pill
//   • POST /api/projects/[id]/regenerate-partial       — apply-drafts batch
//
// Both routes used to carry near-identical:
//   1. `getOriginalQuality` lookup (newest succeeded deck.generate job)
//   2. `allocateNextVersion` P2002-retry version-seeding helper
//   3. `rollbackVersionAndJob` failure-path cleanup
//
// Lifted here (2026-05-27 simplifier pass) so the two routes can keep
// their orchestration short and the shared logic stays in one place.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isQuality, type Quality } from "@/lib/types/quality";

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
 * Look up the original deck's quality preset from the most recent
 * SUCCEEDED `deck.generate` Job for this project. The result is
 * forwarded to the partial-regen function so the redesign uses the
 * SAME model + thinking the user picked when first generating —
 * without it every regen burned Opus tier regardless. Falls through
 * to `null` when no successful job exists or the field is missing
 * on older jobs (paramsForQuality then defaults to "medium").
 */
export async function getOriginalQuality(
  projectId: string,
): Promise<Quality | null> {
  const lastJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: "deck.generate",
      status: "succeeded",
    },
    orderBy: { createdAt: "desc" },
    select: { inputJson: true },
  });
  const lastInput = (lastJob?.inputJson ?? null) as { quality?: unknown } | null;
  return isQuality(lastInput?.quality) ? lastInput.quality : null;
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
): Promise<{ id: string; versionNumber: number }> {
  const latest = await tx.presentationVersion.findFirst({
    where: { presentationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, slideJson: true },
  });
  const nextNumber = (latest?.versionNumber ?? 0) + 1;
  return tx.presentationVersion.create({
    data: {
      presentationId,
      versionNumber: nextNumber,
      status: "queued",
      slideJson: toJson(latest?.slideJson ?? { status: "queued", slides: [] }),
    },
    select: { id: true, versionNumber: true },
  });
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
