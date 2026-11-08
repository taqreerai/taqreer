// Cost attribution inside Inngest steps (2026-11-08). The functions wrap their
// handler in withUsageContext(...), but Inngest runs each step.run body from
// its own engine loop, outside the handler's AsyncLocalStorage chain, so AI
// calls made inside a step were saved with no deck. This re-applies the same
// attribution around every step handler, read from the triggering event:
// the deck (data.projectId), else the extraction job (data.jobId) as the
// sourceKey the projects route later re-keys onto the new deck.

import { Middleware } from "inngest";
import { withUsageContext, type UsageCtx } from "@/lib/anthropic/usage-log";

function usageCtxOf(data: unknown): UsageCtx | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.projectId === "string") return { projectId: d.projectId };
  if (typeof d.jobId === "string") return { sourceKey: d.jobId };
  return null;
}

export class UsageContextMiddleware extends Middleware.BaseMiddleware {
  readonly id = "taqreer-usage-context";

  wrapStepHandler(args: Middleware.WrapStepHandlerArgs): Promise<unknown> {
    const ctx = usageCtxOf((args.ctx as { event?: { data?: unknown } }).event?.data);
    return ctx ? withUsageContext(ctx, () => args.next()) : args.next();
  }
}
