import { inngest } from "@/inngest/client";

type InngestEvent = Parameters<typeof inngest.send>[0];

/**
 * Send an Inngest event with retry-with-backoff. Necessary because we fire
 * events *after* committing a DB transaction that sets the related Job/Project
 * status to "queued"; if the send fails and there's no retry, the row sits in
 * "queued" forever.
 *
 * Retries 4 times with exponential backoff (0.2s, 0.5s, 1.5s, 4s). Throws on
 * final failure so the calling route can return 500.
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
