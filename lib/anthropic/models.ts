// Live Anthropic model list for the admin Settings preset picker. Calls
// GET /v1/models (client.models.list), cached in-process for 5 minutes.
// Graceful: a missing key or an API error returns the last cache (or []),
// so the picker degrades to free-text entry of the stored model id rather
// than blocking the page.

import Anthropic from "@anthropic-ai/sdk";

export type LiveModel = { id: string; displayName: string };

let cache: { models: LiveModel[]; at: number } | null = null;
const TTL_MS = 5 * 60_000;

export async function listModels(): Promise<LiveModel[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.models;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return cache?.models ?? [];

  try {
    const client = new Anthropic({ apiKey });
    // The catalog is small (~dozens); one page of up to 1000 covers it.
    const page = await client.models.list({ limit: 1000 });
    const models = page.data
      .map((m) => ({ id: m.id, displayName: m.display_name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    cache = { models, at: now };
    return models;
  } catch (err) {
    console.error("[models] list failed, serving cache/[]:", err);
    return cache?.models ?? [];
  }
}
