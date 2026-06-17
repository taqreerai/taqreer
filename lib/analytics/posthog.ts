import "server-only";

// Server-only read layer for the admin Overview analytics (PostHog Query API).
// Auth uses the PERSONAL API key (a secret; never NEXT_PUBLIC) + the numeric
// project id. The public phc_ token can only WRITE events, not read them back.
//
// Everything degrades gracefully: missing env or any API error returns null so
// the UI shows "not configured" / "no data" instead of throwing. Results are
// memoised for 60s (module-level) so admins refreshing the page don't hammer
// the Query API rate limit.

const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

export type ChannelRow = { label: string; visitors: number; pct: number };

async function posthogQuery(hogql: string): Promise<unknown[][] | null> {
  if (!HOST || !PROJECT_ID || !PERSONAL_KEY) return null;
  try {
    const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERSONAL_KEY}`,
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: unknown[][]; error?: unknown };
    if (data.error) return null;
    return Array.isArray(data.results) ? data.results : null;
  } catch {
    return null;
  }
}

// PostHog auto-classifies each session's entry channel into $channel_type
// (Direct, Organic Search, Paid Search, Organic Social, Referral, Email, ...).
// Visitors = distinct persons per channel over the last 30 days.
const CHANNEL_HOGQL = `
SELECT properties.$channel_type AS channel, count(distinct person_id) AS visitors
FROM events
WHERE timestamp > now() - interval 30 day
GROUP BY channel
ORDER BY visitors DESC
LIMIT 12`;

async function fetchChannels(): Promise<ChannelRow[] | null> {
  const rows = await posthogQuery(CHANNEL_HOGQL);
  if (!rows) return null;
  const parsed = rows
    .map((r) => ({
      label: typeof r[0] === "string" && r[0] ? r[0] : "Unknown",
      visitors: Number(r[1]) || 0,
    }))
    .filter((r) => r.visitors > 0);
  const total = parsed.reduce((s, r) => s + r.visitors, 0) || 1;
  return parsed.map((r) => ({ ...r, pct: Math.round((r.visitors / total) * 100) }));
}

let channelCache: { at: number; data: ChannelRow[] | null } | null = null;
const TTL_MS = 60_000;

export async function getChannelBreakdown(): Promise<ChannelRow[] | null> {
  if (channelCache && Date.now() - channelCache.at < TTL_MS) {
    return channelCache.data;
  }
  const data = await fetchChannels();
  channelCache = { at: Date.now(), data };
  return data;
}
