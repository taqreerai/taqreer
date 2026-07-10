import "server-only";

import type { CountryVisitors, Breakdown } from "@/lib/admin/mock";

// Server-only read layer for the admin Overview analytics (PostHog Query API).
// Auth uses the PERSONAL API key (a secret; never NEXT_PUBLIC) + the numeric
// project id. The public phc_ token can only WRITE events, not read them back.
//
// Everything degrades gracefully: missing env or any API error returns null /
// empty so the UI shows "not configured" / "no data" instead of throwing. Each
// reader is memoised (module-level TTL) so admins refreshing the page don't
// hammer the Query API rate limit. All HogQL is STATIC (no user input).

const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

export type ChannelRow = { label: string; visitors: number; pct: number };
export type DeviceBreakdowns = {
  device: Breakdown[];
  browser: Breakdown[];
  os: Breakdown[];
};

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

// Module-level TTL memo so concurrent / repeat Overview loads share one result.
function memo<T>(fn: () => Promise<T>, ttlMs = 60_000): () => Promise<T> {
  let cache: { at: number; value: T } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.value;
    const value = await fn();
    cache = { at: Date.now(), value };
    return value;
  };
}

// ─── Sources by channel ─────────────────────────────────────────────────────
// PostHog auto-classifies each session's entry channel into $channel_type
// (Direct, Organic Search, Paid Search, Organic Social, Referral, Email, ...).
// It is a SESSION property (session.*), not an event property - reading
// properties.$channel_type returns null for every event and buckets all
// traffic under "Unknown".
const CHANNEL_HOGQL = `
SELECT session.$channel_type AS channel, count(distinct person_id) AS visitors
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

export const getChannelBreakdown = memo(fetchChannels);

// ─── Geo (globe) ────────────────────────────────────────────────────────────
// Distinct visitors per country over 30 days, with the country centroid taken
// straight from PostHog GeoIP ($geoip_latitude/$geoip_longitude) so the globe
// can plot + rotate to each country without a static centroid table.
const GEO_HOGQL = `
SELECT properties.$geoip_country_code AS code,
       any(properties.$geoip_country_name) AS name,
       avg(toFloat(properties.$geoip_latitude)) AS lat,
       avg(toFloat(properties.$geoip_longitude)) AS lng,
       count(distinct person_id) AS visitors
FROM events
WHERE timestamp > now() - interval 30 day
  AND properties.$geoip_country_code != ''
GROUP BY code
ORDER BY visitors DESC
LIMIT 30`;

async function fetchGeo(): Promise<CountryVisitors[] | null> {
  const rows = await posthogQuery(GEO_HOGQL);
  if (!rows) return null;
  return rows
    .map((r) => ({
      code: typeof r[0] === "string" ? r[0] : "",
      name:
        typeof r[1] === "string" && r[1]
          ? r[1]
          : typeof r[0] === "string"
            ? r[0]
            : "Unknown",
      lat: Number(r[2]),
      lng: Number(r[3]),
      count: Number(r[4]) || 0,
    }))
    .filter(
      (v) =>
        v.code &&
        v.count > 0 &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lng),
    );
}

export const getGeoVisitors = memo(fetchGeo);

// ─── Online now ─────────────────────────────────────────────────────────────
// Distinct persons with any event in the last 5 minutes (PostHog has no true
// presence; recent activity is the honest proxy). Shorter TTL than the rest.
const ONLINE_HOGQL = `
SELECT count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 5 minute`;

async function fetchOnline(): Promise<number> {
  const rows = await posthogQuery(ONLINE_HOGQL);
  if (!rows || !rows[0]) return 0;
  return Number(rows[0][0]) || 0;
}

export const getOnlineNow = memo(fetchOnline, 30_000);

// ─── Traffic totals (geo card header strip) ─────────────────────────────────
// Unique visitors = distinct persons (30d); pageviews = $pageview count (30d).
export type TrafficTotals = { uniqueVisitors: number; pageviews: number };

const TOTALS_HOGQL = `
SELECT count(distinct person_id) AS uniques, countIf(event = '$pageview') AS pageviews
FROM events
WHERE timestamp > now() - interval 30 day`;

async function fetchTotals(): Promise<TrafficTotals> {
  const rows = await posthogQuery(TOTALS_HOGQL);
  if (!rows || !rows[0]) return { uniqueVisitors: 0, pageviews: 0 };
  return {
    uniqueVisitors: Number(rows[0][0]) || 0,
    pageviews: Number(rows[0][1]) || 0,
  };
}

export const getTrafficTotals = memo(fetchTotals);

// ─── Traffic by device / browser / os ───────────────────────────────────────
const DEVICE_HOGQL = `
SELECT properties.$device_type AS k, count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 30 day AND properties.$device_type != ''
GROUP BY k ORDER BY n DESC LIMIT 8`;
const BROWSER_HOGQL = `
SELECT properties.$browser AS k, count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 30 day AND properties.$browser != ''
GROUP BY k ORDER BY n DESC LIMIT 8`;
const OS_HOGQL = `
SELECT properties.$os AS k, count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 30 day AND properties.$os != ''
GROUP BY k ORDER BY n DESC LIMIT 8`;

async function toBreakdown(hogql: string): Promise<Breakdown[]> {
  const rows = await posthogQuery(hogql);
  if (!rows) return [];
  const parsed = rows
    .map((r) => ({
      label: typeof r[0] === "string" && r[0] ? r[0] : "Other",
      count: Number(r[1]) || 0,
    }))
    .filter((r) => r.count > 0);
  const total = parsed.reduce((s, r) => s + r.count, 0) || 1;
  return parsed.map((r) => ({ label: r.label, pct: Math.round((r.count / total) * 100) }));
}

async function fetchDeviceBreakdowns(): Promise<DeviceBreakdowns> {
  const [device, browser, os] = await Promise.all([
    toBreakdown(DEVICE_HOGQL),
    toBreakdown(BROWSER_HOGQL),
    toBreakdown(OS_HOGQL),
  ]);
  return { device, browser, os };
}

export const getDeviceBreakdowns = memo(fetchDeviceBreakdowns);

// ─── Conversion funnel ──────────────────────────────────────────────────────
// signed_up -> deck_created -> deck_exported -> purchase_completed, ORDERED,
// 30-day window per person. windowFunnel returns the furthest consecutive step
// each person reached (in order); countIf(level >= n) = persons who reached
// step n. Events are fired server-side (lib/analytics/posthog-server.ts).
export type FunnelStep = { label: string; count: number };

const FUNNEL_HOGQL = `
SELECT
  countIf(level >= 1) AS signed_up,
  countIf(level >= 2) AS deck_created,
  countIf(level >= 3) AS deck_exported,
  countIf(level >= 4) AS purchased
FROM (
  SELECT
    person_id,
    windowFunnel(2592000)(
      toUnixTimestamp(timestamp),
      event = 'signed_up',
      event = 'deck_created',
      event = 'deck_exported',
      event = 'purchase_completed'
    ) AS level
  FROM events
  WHERE timestamp > now() - interval 30 day
    AND event IN ('signed_up', 'deck_created', 'deck_exported', 'purchase_completed')
  GROUP BY person_id
)`;

async function fetchFunnel(): Promise<FunnelStep[] | null> {
  const rows = await posthogQuery(FUNNEL_HOGQL);
  if (!rows || !rows[0]) return null;
  const r = rows[0];
  return [
    { label: "Signed up", count: Number(r[0]) || 0 },
    { label: "Created a deck", count: Number(r[1]) || 0 },
    { label: "Exported", count: Number(r[2]) || 0 },
    { label: "Purchased", count: Number(r[3]) || 0 },
  ];
}

export const getFunnel = memo(fetchFunnel);
