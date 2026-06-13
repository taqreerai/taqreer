import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

type InngestEvent = Parameters<typeof inngest.send>[0];

/**
 * The billing tier (free/plus/pro/max) for a Prisma user id, or null when the
 * id is missing/unknown. Stamped onto deck.generate / regen events as `tier` so
 * the functions' `priority.run` CEL can give Max-tier runs queue priority under
 * contention (the CEL evaluates at enqueue, before the run, so the value MUST
 * travel on the event).
 */
export async function tierForUser(
  prismaUserId: string | null | undefined,
): Promise<string | null> {
  if (!prismaUserId) return null;
  const user = await prisma.user.findUnique({
    where: { id: prismaUserId },
    select: { plan: true },
  });
  return user?.plan ?? null;
}

/**
 * Send an Inngest event with retry-with-backoff. Necessary because we fire
 * events *after* committing a DB transaction that sets the related Job/Project
 * status to "queued"; if the send fails and there's no retry, the row sits in
 * "queued" forever.
 *
 * Up to 4 attempts total with 3 delays in between (~200ms, ~500ms, ~1.25s)
 * plus ~0–100ms jitter on each. ~2 seconds of total wait before throwing
 * on final failure so the calling route can return 500.
 */
export async function sendInngestEventWithRetry(
  event: InngestEvent,
  attempts = 4,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await inngest.send(event);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        const delayMs = 200 * Math.pow(2.5, attempt) + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(
    `Failed to send Inngest event after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
