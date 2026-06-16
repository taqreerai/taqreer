// Admin > Overview (server). Gates on admin, computes the real KPI / plan /
// activity aggregates (lib/admin/stats.ts), and hands them to the client
// renderer (the WebGL globe is client-only). The geo globe + device breakdown
// remain mock until analytics capture exists.

import { requireAdminPage } from "@/lib/api/admin-context";
import { getOverviewStats } from "@/lib/admin/stats";
import { OverviewClient } from "@/components/admin/OverviewClient";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const { stats, planSplit, activity } = await getOverviewStats();
  return <OverviewClient stats={stats} planSplit={planSplit} activity={activity} />;
}
