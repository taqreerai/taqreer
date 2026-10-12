// One-time deck unlock (owner decision 2026-10-08): a free owner buys ONE
// teaser deck outright instead of subscribing. Priced by the deck's planned
// size (the free slides + the locked tail), $1 apart per bracket:
//
//   up to 15 slides  $4.99   ·   16-30  $5.99   ·   31-50  $6.99
//
// Above 50 slides it is subscription only. The webhook records the purchase
// (DeckPurchase + Project.purchasedAt) and starts the same comped unlock a
// subscriber gets (dispatchTeaserUnlock below). Server-only.

import { prisma } from "@/lib/prisma";
import { sendInngestEventWithRetry, tierForUser } from "@/lib/inngest-helpers";
import { toJson } from "@/lib/api/regen-helpers";
import { ensureFresh } from "@/lib/config/runtime-config";
import { regionFreePreset } from "@/lib/credits/region-model";

export {
  DECK_UNLOCK_BRACKETS,
  bracketForSlides,
  deckUnlockLookupKey,
  teaserTotalSlides,
  type DeckUnlockBracket,
} from "@/lib/billing/deck-unlock-brackets";

// Lowest Opus preset every paid tier affords. The unlocked tail is crafted on
// Opus, for a subscriber and for a one-time buyer alike - EXCEPT a one-time
// buyer from a region-limited country (still on the free plan): their tail is
// written with the same Haiku preset as the free part (owner decision
// 2026-10-12), so no Opus runs and both halves match. The bake's review is
// already skipped for free owners (lib/deck/review-gate).
const UNLOCK_PRESET = "opus-fast";

export type DispatchResult =
  | { ok: true; alreadyUnlocked?: boolean; alreadyRunning?: boolean }
  | { ok: false; status: number; error: string };

/**
 * Start the comped generation of a teaser deck's locked slides. Callers own
 * the ENTITLEMENT check (paid owner, admin, or a purchase); this owns the
 * deck-state checks (still locked, not already running) and the dispatch.
 * Idempotent: an unlocked deck or an in-flight job is a no-op success.
 */
export async function dispatchTeaserUnlock(
  projectId: string,
  actorPrismaUserId: string | null,
): Promise<DispatchResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teaserLockedCount: true,
      teaserUnlockedAt: true,
      userId: true,
      presentation: { select: { id: true, currentVersionId: true } },
    },
  });
  if (!project?.presentation?.currentVersionId) {
    return { ok: false, status: 404, error: "Project not found" };
  }
  if (project.teaserLockedCount <= 0 || project.teaserUnlockedAt != null) {
    return { ok: true, alreadyUnlocked: true };
  }
  const inFlight = await prisma.job.findFirst({
    where: {
      projectId,
      type: "deck.unlock",
      status: { in: ["queued", "processing", "running"] },
    },
    select: { id: true },
  });
  if (inFlight) return { ok: true, alreadyRunning: true };

  // Region-limited one-time buyers get the Haiku tail (see UNLOCK_PRESET).
  await ensureFresh();
  const owner = await prisma.user.findUnique({
    where: { id: project.userId },
    select: { plan: true, role: true, signupCountry: true },
  });
  const unlockPreset = (owner && regionFreePreset(owner)) ?? UNLOCK_PRESET;

  const presentation = project.presentation;
  const sourceVersionId = presentation.currentVersionId!;
  let jobId: string | null = null;
  try {
    const job = await prisma.job.create({
      data: {
        project: { connect: { id: project.id } },
        type: "deck.unlock",
        status: "queued",
        inputJson: toJson({
          sourceVersionId,
          lockedCount: project.teaserLockedCount,
          quality: unlockPreset,
        }),
        quality: unlockPreset,
      },
    });
    jobId = job.id;
    await sendInngestEventWithRetry({
      name: "deck.unlock.requested",
      // Deterministic id: two concurrent unlocks (button + webhook, or a
      // double click) dedup to ONE comped run.
      id: `deck-unlock:${project.id}:${sourceVersionId}`,
      data: {
        projectId: project.id,
        presentationId: presentation.id,
        sourceVersionId,
        lockedCount: project.teaserLockedCount,
        quality: unlockPreset,
        jobId: job.id,
        actorPrismaUserId,
        // Processing priority follows the OWNER's tier (they own the deck).
        tier: await tierForUser(project.userId),
      },
    });
  } catch (error) {
    if (jobId) {
      await prisma.job.delete({ where: { id: jobId } }).catch(() => undefined);
    }
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "Failed to dispatch unlock",
    };
  }
  return { ok: true };
}

/**
 * Webhook side of a one-time deck unlock (checkout.session.completed): record
 * the purchase, mark the deck as bought (no watermark from now on) and start
 * the comped unlock. Idempotent on the Checkout Session id; a session that is
 * not paid, or a deck that is not the buyer's, records nothing.
 */
export async function recordDeckPurchase(opts: {
  prismaUserId: string;
  projectId: string;
  bracket: string;
  sessionId: string;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
}): Promise<{ recorded: boolean; reason?: string }> {
  if (opts.paymentStatus !== "paid") return { recorded: false, reason: "not_paid" };
  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { userId: true, purchasedAt: true },
  });
  if (!project || project.userId !== opts.prismaUserId) {
    return { recorded: false, reason: "not_owner" };
  }
  try {
    await prisma.$transaction([
      prisma.deckPurchase.create({
        data: {
          userId: opts.prismaUserId,
          projectId: opts.projectId,
          stripeSessionId: opts.sessionId,
          paymentIntentId: opts.paymentIntentId,
          amountCents: opts.amountCents ?? 0,
          currency: opts.currency ?? "usd",
          bracket: opts.bracket,
        },
      }),
      prisma.project.update({
        where: { id: opts.projectId },
        data: { purchasedAt: project.purchasedAt ?? new Date() },
      }),
    ]);
  } catch (err) {
    // Unique stripeSessionId: this session was already recorded (a retried
    // webhook). Fall through to the idempotent dispatch below.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") throw err;
  }
  const dispatched = await dispatchTeaserUnlock(opts.projectId, opts.prismaUserId);
  if (!dispatched.ok) {
    // The purchase stands; the owner's unlock button (now entitled) retries.
    console.error("[deck-unlock] dispatch after purchase failed", {
      projectId: opts.projectId,
      error: dispatched.error,
    });
  }
  return { recorded: true };
}

/**
 * charge.refunded for a deck purchase: mark it refunded and, when no other
 * live purchase covers the deck, clear Project.purchasedAt (the watermark
 * returns; the unlocked slides stay).
 */
export async function refundDeckPurchase(paymentIntentId: string): Promise<boolean> {
  const purchase = await prisma.deckPurchase.findFirst({
    where: { paymentIntentId, refundedAt: null },
    select: { id: true, projectId: true },
  });
  if (!purchase) return false;
  await prisma.deckPurchase.update({
    where: { id: purchase.id },
    data: { refundedAt: new Date() },
  });
  if (purchase.projectId) {
    const stillCovered = await prisma.deckPurchase.count({
      where: { projectId: purchase.projectId, refundedAt: null },
    });
    if (stillCovered === 0) {
      await prisma.project.update({
        where: { id: purchase.projectId },
        data: { purchasedAt: null },
      });
    }
  }
  return true;
}
