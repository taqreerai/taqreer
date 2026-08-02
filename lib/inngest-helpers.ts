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
 * Drop enhance `textPerSlide` from a deck.generate.requested payload before it
 * goes on the WIRE. Inngest hard-caps events at 256KB, and a dense multi-slide
 * deck's verbatim text was the last brief field that could organically exceed
 * it (PR #181 follow-up; the logo had the same failure class in PR #180). The
 * FULL array must stay in Job.inputJson - that row is the durable brief home
 * (the version's slideJson.brief is overwritten by deck-generate's first
 * progress write) and deck-generate re-hydrates from it by jobId.
 *
 * Contract with deck-generate's enhance prep:
 *   - key ABSENT on the wire  -> non-empty text exists in Job.inputJson, fetch
 *   - key PRESENT (any array) -> use as-is (legacy in-flight events, and the
 *     legitimately-empty [] of an image-only enhance, which skips the fetch)
 *
 * Non-mutating: every caller writes the SAME payload object to Job.inputJson,
 * which must keep the full array.
 */
export function stripSlideTextForWire<T extends object>(payload: T): T {
  // `T extends object` (not `{ brief?: unknown }`) because the emitters pass
  // loosely-typed replay payloads (regenerate spreads a Record built from
  // Job.inputJson whose inferred type carries no `brief` key).
  const brief = (payload as { brief?: unknown }).brief as
    | { source?: { kind?: unknown; textPerSlide?: unknown } }
    | null
    | undefined;
  const source = brief?.source;
  if (
    !source ||
    source.kind !== "enhance" ||
    !Array.isArray(source.textPerSlide) ||
    source.textPerSlide.length === 0
  ) {
    return payload;
  }
  const { textPerSlide: _stripped, ...wireSource } = source;
  void _stripped;
  return { ...payload, brief: { ...brief, source: wireSource } };
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
