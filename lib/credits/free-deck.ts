// One free deck per account (owner, 2026-11-11). A free Create deck builds 5
// slides (about 200 of the 400 signup credits), so the leftover paid for a
// second deck. A free account now gets one generation in any flow; the
// leftover stays on the account (AI edits are a paid feature already,
// lib/free-trial.ts FREE_AI_EDIT_LOCK).
//
// What counts: a full generation's credit hold (metadata.kind
// "deck.generate"), held or charged. Holds live on the user, not the project,
// so deleting the deck does not give the free deck back. A released hold, or
// one settled at 0 (failed, cancelled, refunded), does not count, so Retry on
// a failed generation still works. A generation still queued has no hold yet
// (it is taken when the run starts), so queued and running deck jobs on the
// user's projects count too: two quick submits cannot both get through. A
// deck job stays "queued" while it runs, and a few never left it, so only
// recent ones count (ACTIVE_WINDOW_MS), or a stuck job would block forever.
// Server-only.

import { prisma } from "@/lib/prisma";

const ACTIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function freeDeckUsed(userId: string): Promise<boolean> {
  const [hold, active] = await Promise.all([
    prisma.creditHold.findFirst({
      where: {
        userId,
        metadata: { path: ["kind"], equals: "deck.generate" },
        OR: [{ status: "held" }, { status: "settled", amountCharged: { gt: 0 } }],
      },
      select: { id: true },
    }),
    prisma.job.findFirst({
      where: {
        type: "deck.generate",
        status: { in: ["queued", "running"] },
        createdAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
        project: { userId },
      },
      select: { id: true },
    }),
  ]);
  return hold !== null || active !== null;
}
