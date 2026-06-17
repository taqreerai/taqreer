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
  getDeviceBreakdowns,
} from "@/lib/analytics/posthog";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const [{ stats, planSplit, activity }, channels, geo, onlineNow, device] =
    await Promise.all([
      getOverviewStats(),
      getChannelBreakdown(),
      getGeoVisitors(),
      getOnlineNow(),
      getDeviceBreakdowns(),
    ]);
  return (
    <OverviewClient
      stats={stats}
      planSplit={planSplit}
      activity={activity}
      channels={channels}
      geo={geo ?? []}
      onlineNow={onlineNow}
      device={device}
    />
  );
}
