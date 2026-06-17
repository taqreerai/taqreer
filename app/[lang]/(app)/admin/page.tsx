// Admin > Overview (server). Gates on admin, then fetches everything in
// parallel: the real KPI / plan / activity aggregates (lib/admin/stats.ts) and
// the PostHog read-backs (sources by channel, geo visitors for the globe,
// online-now, device/browser/os). All hands to the client renderer (the WebGL
// globe is client-only). No mock data left on this screen.

import { requireAdminPage } from "@/lib/api/admin-context";
import { getOverviewStats } from "@/lib/admin/stats";
import {
  getChannelBreakdown,
  getGeoVisitors,
  getOnlineNow,
  getTrafficTotals,
  getDeviceBreakdowns,
  getFunnel,
} from "@/lib/analytics/posthog";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const [
    { stats, planSplit, activity },
    channels,
    geo,
    onlineNow,
    traffic,
    device,
    funnel,
  ] = await Promise.all([
    getOverviewStats(),
    getChannelBreakdown(),
    getGeoVisitors(),
    getOnlineNow(),
    getTrafficTotals(),
    getDeviceBreakdowns(),
    getFunnel(),
  ]);
  return (
    <OverviewClient
      stats={stats}
      planSplit={planSplit}
      activity={activity}
      channels={channels}
      geo={geo ?? []}
      onlineNow={onlineNow}
      traffic={traffic}
      device={device}
      funnel={funnel}
    />
  );
}
