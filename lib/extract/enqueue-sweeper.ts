// Durable hand-off for POST /api/extract.
//
// The route uploads the user's file, creates the Job, then sends the
// `source.extract.requested` event to Inngest. On 2026-10-20 the send failed
// for ~2 minutes ("other side closed" from two different Inngest edge IPs, no
// incident posted, healthy before and after) and every attempt cost the user a
// full re-upload of a 24 MB file. A hand-off failure is not the user's problem:
// the file is already stored and the Job exists, so the route now records what
// it could not send on the Job (outputJson._pendingEnqueue) and answers
// normally; this sweeper keeps re-sending (same event id, so it is idempotent)
// until Inngest accepts it, and only fails the Job after GIVE_UP_MS.
//
// Runs in the Next server process (instrumentation.ts, prod only). State lives
// in the DB, so a restart loses nothing.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

const SWEEP_EVERY_MS = 20_000;
const GIVE_UP_MS = 15 * 60_000;

export type PendingExtractEvent = {
  jobId: string;
  supabaseUserId: string;
  fileBucketPath: string;
  fileName: string;
  mime: string;
  flowKind: string;
  mimicRole?: string;
};

type Pending = { event: PendingExtractEvent; firstFailedAt: string; attempts: number };

/** Remember an event the route could not hand to Inngest (called from the route's catch). */
export async function parkPendingExtract(event: PendingExtractEvent, reason: string): Promise<void> {
  const pending: Pending = { event, firstFailedAt: new Date().toISOString(), attempts: 1 };
  await prisma.job.update({
    where: { id: event.jobId },
    data: { outputJson: { _pendingEnqueue: pending, _lastEnqueueError: reason.slice(0, 300) } as unknown as Prisma.InputJsonValue },
  });
}

let running = false;

export async function sweepPendingExtracts(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await prisma.job.findMany({
      where: { type: "source-extract", status: "queued", createdAt: { gt: new Date(Date.now() - 60 * 60_000) } },
      select: { id: true, createdAt: true, outputJson: true },
      take: 50,
    });
    for (const row of rows) {
      const pending = (row.outputJson as { _pendingEnqueue?: Pending } | null)?._pendingEnqueue;
      if (!pending) continue;
      if (Date.now() - new Date(pending.firstFailedAt).getTime() > GIVE_UP_MS) {
        await prisma.job.updateMany({
          where: { id: row.id, status: "queued" },
          data: { status: "failed", outputJson: { error: "Failed to enqueue extraction job" } },
        });
        console.error("[extract-sweeper] gave up on", row.id);
        continue;
      }
      try {
        await inngest.send({ name: "source.extract.requested", id: `extract:${row.id}`, data: pending.event });
        // Delivered: drop the marker (extract-source writes its own progress next).
        await prisma.job.updateMany({
          where: { id: row.id, status: "queued" },
          data: { outputJson: Prisma.DbNull },
        });
        console.info("[extract-sweeper] delivered", row.id, "after", pending.attempts, "failed attempts");
      } catch (err) {
        await prisma.job.updateMany({
          where: { id: row.id, status: "queued" },
          data: {
            outputJson: {
              _pendingEnqueue: { ...pending, attempts: pending.attempts + 1 },
              _lastEnqueueError: (err instanceof Error ? err.message : String(err)).slice(0, 300),
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
  } catch (err) {
    console.error("[extract-sweeper] sweep failed:", err);
  } finally {
    running = false;
  }
}

let started = false;
export function startExtractSweeper(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => void sweepPendingExtracts(), SWEEP_EVERY_MS);
  timer.unref?.();
  void sweepPendingExtracts();
}
