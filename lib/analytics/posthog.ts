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

export type ChannelRow = {
  label: string;
  // PostHog channel classification (Paid Search, Organic Social...) shown as a
  // muted suffix; empty for Direct (self-explanatory).
  channel: string;
  visitors: number;
  pct: number;
};
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

// Client pageviews from a dev machine carry $host = localhost:<port> (or
// 127.0.0.1) and would otherwise pollute every visitor count. coalesce keeps
// server-side events (no $host) included - in ClickHouse a bare NULL
// comparison is falsy and would silently drop them.
const NOT_LOCALHOST = `NOT startsWith(coalesce(properties.$host, ''), 'localhost')
  AND NOT startsWith(coalesce(properties.$host, ''), '127.0.0.1')`;

// ─── Traffic sources ────────────────────────────────────────────────────────
// Named source per session entry: utm_source when the link was tagged (Google
// Ads suffix, tagged banners), else the referring domain. The channel column is
// PostHog's session classification ($channel_type: Paid Search, Organic
// Social...) kept as a display suffix. Both are SESSION properties (session.*),
// not event properties - reading properties.$channel_type returns null for
// every event and buckets all traffic under "Unknown". Sessionless rows
// (server-side captures) are dropped: they are not visits.
const SOURCE_HOGQL = `
SELECT coalesce(nullIf(session.$entry_utm_source, ''), session.$entry_referring_domain) AS src,
       session.$channel_type AS channel,
       count(distinct person_id) AS visitors
FROM events
WHERE timestamp > now() - interval 30 day
  AND ${NOT_LOCALHOST}
  AND coalesce(nullIf(session.$entry_utm_source, ''), session.$entry_referring_domain) != ''
GROUP BY src, channel
ORDER BY visitors DESC
LIMIT 24`;

// Collapse raw sources into readable names. Self-referrals and OAuth bounces
// (accounts.google.*) are session re-entries, not acquisition sources - they
// fold into Direct. Instagram arrives as "ig" (our own utm tag) or
// l.instagram.com (the in-app browser's link shim) - one label for all.
function prettySource(raw: string): string {
  if (raw === "$direct" || raw === "taqreer.ai") return "Direct";
  if (raw.startsWith("accounts.google")) return "Direct";
  if (raw === "com.google.android.gm") return "gmail";
  if (raw === "ig" || raw === "instagram.com" || raw === "l.instagram.com")
    return "instagram";
  return raw.replace(/^www\./, "");
}

async function fetchChannels(): Promise<ChannelRow[] | null> {
  const rows = await posthogQuery(SOURCE_HOGQL);
  if (!rows) return null;
  // Merge post-normalization duplicates (e.g. ig + l.instagram.com). Direct
  // merges regardless of channel - "Direct · Referral" for an OAuth bounce
  // would be noise, not signal.
  const merged = new Map<string, { label: string; channel: string; visitors: number }>();
  for (const r of rows) {
    const visitors = Number(r[2]) || 0;
    if (!visitors || typeof r[0] !== "string" || !r[0]) continue;
    const label = prettySource(r[0]);
    const channel = label === "Direct" || typeof r[1] !== "string" ? "" : r[1];
    const key = `${label}|${channel}`;
    const prev = merged.get(key);
    if (prev) prev.visitors += visitors;
    else merged.set(key, { label, channel, visitors });
  }
  const parsed = [...merged.values()].sort((a, b) => b.visitors - a.visitors).slice(0, 10);
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
  AND ${NOT_LOCALHOST}
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
WHERE timestamp > now() - interval 5 minute
  AND ${NOT_LOCALHOST}`;

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
WHERE timestamp > now() - interval 30 day
  AND ${NOT_LOCALHOST}`;

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
  AND ${NOT_LOCALHOST}
GROUP BY k ORDER BY n DESC LIMIT 8`;
const BROWSER_HOGQL = `
SELECT properties.$browser AS k, count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 30 day AND properties.$browser != ''
  AND ${NOT_LOCALHOST}
GROUP BY k ORDER BY n DESC LIMIT 8`;
const OS_HOGQL = `
SELECT properties.$os AS k, count(distinct person_id) AS n
FROM events
WHERE timestamp > now() - interval 30 day AND properties.$os != ''
  AND ${NOT_LOCALHOST}
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
