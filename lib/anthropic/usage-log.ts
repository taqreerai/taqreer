// Token usage + real cost for every AI call (2026-11-07). One LlmUsage row
// per call: Anthropic calls through `tracked()`, gpt-image calls through
// `logImageUsage()`. Fire-and-forget: a failed write never affects the caller.
//
// ATTRIBUTION: rows carry the deck (projectId), the account (userId) and, for
// work done before a deck exists, a sourceKey (the extraction job id that a
// deck's source path names, or a request key the projects route re-keys onto
// the new deck). Entry points set it once with `withUsageContext()`; every
// call made inside (awaited or streamed) inherits it through AsyncLocalStorage,
// so helpers deep in the pipeline need no extra arguments.

import { AsyncLocalStorage } from "node:async_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { anthropicCostMicros, imageCostMicros } from "@/lib/anthropic/pricing";

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined;

export type UsageCtx = {
  projectId?: string | null;
  userId?: string | null;
  sourceKey?: string | null;
  // Writes still in flight, so a caller can wait for them (the projects route
  // re-keys its pre-deck rows onto the new deck after they land).
  pending?: Promise<unknown>[];
};

const store = new AsyncLocalStorage<UsageCtx>();

/** Run `fn` with this attribution for every AI call it makes. Nested calls merge. */
export function withUsageContext<T>(ctx: UsageCtx, fn: () => T): T {
  const parent = store.getStore();
  return store.run({ ...parent, ...ctx, pending: parent?.pending ?? ctx.pending ?? [] }, fn);
}

/**
 * For an API route: attribute every AI call from here to the end of this
 * request (AsyncLocalStorage.enterWith; the request's own async chain only).
 * Returns the context so the route can re-key its rows later (rekeyUsage).
 */
export function enterUsageContext(ctx: UsageCtx): UsageCtx {
  const full: UsageCtx = { ...store.getStore(), ...ctx, pending: [] };
  store.enterWith(full);
  return full;
}

/**
 * The deck now exists: calls made from here carry it, and the rows this
 * request wrote before it existed (under its request key) are moved onto it.
 */
export async function rekeyUsage(ctx: UsageCtx, projectId: string): Promise<void> {
  ctx.projectId = projectId;
  await Promise.allSettled(ctx.pending ?? []);
  if (!ctx.sourceKey) return;
  await prisma.llmUsage
    .updateMany({ where: { sourceKey: ctx.sourceKey, projectId: null }, data: { projectId } })
    .catch(() => {});
}

/** The deck id on an event payload, when it is a string (Inngest handlers wrap
 *  their body in withUsageContext(projectOf(event.data), ...)). */
export function projectOf(data: Record<string, unknown>): UsageCtx {
  return { projectId: typeof data.projectId === "string" ? data.projectId : null };
}

/** The attribution in force here (for an entry point that must re-key its rows). */
export function currentUsageContext(): UsageCtx | undefined {
  return store.getStore();
}

function write(data: {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costMicros: number;
}, ctx: UsageCtx | undefined): void {
  const p = prisma.llmUsage
    .create({
      data: {
        ...data,
        purpose: data.purpose.slice(0, 64),
        model: data.model.slice(0, 64),
        projectId: ctx?.projectId ?? null,
        userId: ctx?.userId ?? null,
        sourceKey: ctx?.sourceKey ?? null,
      },
    })
    .catch(() => {});
  ctx?.pending?.push(p);
}

export function logUsage(
  purpose: string,
  msg: { model?: string | null; usage?: Usage } | null | undefined,
  ctx?: UsageCtx,
): void {
  const u = msg?.usage;
  if (!u) return;
  const model = msg?.model ?? "unknown";
  const tokens = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  };
  write({ purpose, model, ...tokens, costMicros: anthropicCostMicros(model, tokens) }, { ...store.getStore(), ...ctx });
}

/**
 * Record one gpt-image call (generate or edit). `usage` is the OpenAI images
 * response's usage block; missing = tokens unknown, cost 0 (the row still
 * counts the image).
 */
export function logImageUsage(
  purpose: string,
  model: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    input_tokens_details?: { text_tokens?: number | null; image_tokens?: number | null } | null;
  } | null | undefined,
): void {
  const textIn = usage?.input_tokens_details?.text_tokens ?? usage?.input_tokens ?? 0;
  const imageIn = usage?.input_tokens_details?.image_tokens ?? 0;
  const out = usage?.output_tokens ?? 0;
  write(
    {
      purpose,
      model,
      inputTokens: textIn + imageIn,
      outputTokens: out,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costMicros: imageCostMicros({ textIn, imageIn, out }),
    },
    store.getStore(),
  );
}

/**
 * Record the usage of every `messages.create` / `messages.stream` call made
 * through this client. A stream's internal create call (stream: true) is
 * skipped so a streamed call counts once, from its final message. The
 * attribution is captured when the call is MADE, not when it finishes.
 */
export function tracked<T extends Anthropic>(client: T, purpose: string, ctx?: UsageCtx): T {
  const m = client.messages as unknown as {
    create: (body: { stream?: boolean }, opts?: unknown) => Promise<unknown>;
    stream: (body: unknown, opts?: unknown) => { on: (ev: "finalMessage", cb: (msg: unknown) => void) => unknown };
  };
  const create = m.create.bind(m);
  m.create = (body, opts) => {
    const at = { ...store.getStore(), ...ctx };
    const p = create(body, opts);
    if (!body?.stream) {
      p.then(
        (r) => logUsage(purpose, r as { model?: string; usage?: Usage }, at),
        () => {},
      );
    }
    return p;
  };
  const stream = m.stream.bind(m);
  m.stream = (body, opts) => {
    const at = { ...store.getStore(), ...ctx };
    const s = stream(body, opts);
    s.on("finalMessage", (msg) => logUsage(purpose, msg as { model?: string; usage?: Usage }, at));
    return s;
  };
  return client;
}
