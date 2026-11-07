// Token usage for Anthropic calls that are not already recorded on a Job row
// (2026-11-07). deck-generate and deck-regenerate-partial write their tokens
// onto Job; everything else (PDF reading, reviews, unlocks, picture checks,
// the assistant...) goes through `tracked()` and lands in LlmUsage, one row
// per call. Fire-and-forget: a failed write never affects the caller.

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined;

type Ctx = { projectId?: string | null };

export function logUsage(
  purpose: string,
  msg: { model?: string | null; usage?: Usage } | null | undefined,
  ctx?: Ctx,
): void {
  const u = msg?.usage;
  if (!u) return;
  prisma.llmUsage
    .create({
      data: {
        purpose: purpose.slice(0, 64),
        model: (msg?.model ?? "unknown").slice(0, 64),
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        projectId: ctx?.projectId ?? null,
      },
    })
    .catch(() => {});
}

/**
 * Record the usage of every `messages.create` / `messages.stream` call made
 * through this client. A stream's internal create call (stream: true) is
 * skipped so a streamed call counts once, from its final message.
 */
export function tracked<T extends Anthropic>(client: T, purpose: string, ctx?: Ctx): T {
  const m = client.messages as unknown as {
    create: (body: { stream?: boolean }, opts?: unknown) => Promise<unknown>;
    stream: (body: unknown, opts?: unknown) => { on: (ev: "finalMessage", cb: (msg: unknown) => void) => unknown };
  };
  const create = m.create.bind(m);
  m.create = (body, opts) => {
    const p = create(body, opts);
    if (!body?.stream) {
      p.then(
        (r) => logUsage(purpose, r as { model?: string; usage?: Usage }, ctx),
        () => {},
      );
    }
    return p;
  };
  const stream = m.stream.bind(m);
  m.stream = (body, opts) => {
    const s = stream(body, opts);
    s.on("finalMessage", (msg) => logUsage(purpose, msg as { model?: string; usage?: Usage }, ctx));
    return s;
  };
  return client;
}
