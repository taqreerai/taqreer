// Live Anthropic model list for the admin Settings preset picker. Calls
// GET /v1/models (client.models.list), cached in-process for 5 minutes.
// Graceful: a missing key or an API error returns the last cache (or []),
// so the picker degrades to free-text entry of the stored model id rather
// than blocking the page.
//
// Ordering is NEWEST FIRST (created_at desc) so the latest model is always the
// top option in the admin dropdown; `listModels({ force: true })` busts the TTL
// for the picker's Refresh button (a brand-new model would otherwise take up to
// 5 minutes to appear).

import Anthropic from "@anthropic-ai/sdk";

export type LiveModel = {
  id: string;
  displayName: string;
  // ISO timestamp from the API; null only if a future API omits it.
  createdAt: string | null;
};

let cache: { models: LiveModel[]; at: number } | null = null;
const TTL_MS = 5 * 60_000;

// Newest first. Models with no createdAt sink below dated ones, then sort by
// name so the order is stable rather than API-order.
function byNewestFirst(a: LiveModel, b: LiveModel): number {
  const at = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const bt = b.createdAt ? Date.parse(b.createdAt) : NaN;
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk && bOk && at !== bt) return bt - at;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return a.displayName.localeCompare(b.displayName);
}

export async function listModels(opts?: {
  /** Skip the TTL and re-fetch (admin "Refresh" action). */
  force?: boolean;
}): Promise<LiveModel[]> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.at < TTL_MS) return cache.models;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return cache?.models ?? [];

  try {
    const client = new Anthropic({ apiKey });
    // The catalog is small (~dozens); one page of up to 1000 covers it.
    const page = await client.models.list({ limit: 1000 });
    const models = page.data
      .map((m) => ({
        id: m.id,
        displayName: m.display_name,
        createdAt: m.created_at ?? null,
      }))
      .sort(byNewestFirst);
    cache = { models, at: now };
    return models;
  } catch (err) {
    console.error("[models] list failed, serving cache/[]:", err);
    return cache?.models ?? [];
  }
}
