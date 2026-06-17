// Admin > Overview (server). Gates on admin, computes the real KPI / plan /
// activity aggregates (lib/admin/stats.ts) + the PostHog "sources by channel"
// breakdown, and hands them to the client renderer (the WebGL globe is
// client-only). The geo globe + device breakdown remain mock until the rest of
// the analytics read-back is wired.

import { requireAdminPage } from "@/lib/api/admin-context";
import { getOverviewStats } from "@/lib/admin/stats";
import { getChannelBreakdown } from "@/lib/analytics/posthog";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const [{ stats, planSplit, activity }, channels] = await Promise.all([
    getOverviewStats(),
    getChannelBreakdown(),
  ]);
  return (
    <OverviewClient
      stats={stats}
      planSplit={planSplit}
      activity={activity}
      channels={channels}
    />
  );
}
