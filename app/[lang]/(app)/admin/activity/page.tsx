// Admin > Activity (server). Gates on admin, fetches the user list (name /
// email / signup location), and renders the interactive client. Each user's full
// timeline is lazy-loaded per row via /api/admin/activity/[userId]. A ?user=<id>
// query (from the Overview "Recent activity" widget) auto-expands that user.

import { requireAdminPage } from "@/lib/api/admin-context";
import {
  getActivityUsers,
  getUserActivityTimeline,
} from "@/lib/admin/activity";
import { ActivityClient } from "@/components/admin/ActivityClient";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  await requireAdminPage();
  const [{ user }, users] = await Promise.all([
    searchParams,
    getActivityUsers(),
  ]);
  // Deep-link from the Overview widget: pre-fetch that user's timeline on the
  // server so the row opens already populated (no client fetch-on-mount).
  const initialUserId = user && users.some((u) => u.id === user) ? user : null;
  const initialTimeline = initialUserId
    ? await getUserActivityTimeline(initialUserId)
    : null;
  return (
    <ActivityClient
      users={users}
      initialUserId={initialUserId}
      initialTimeline={initialTimeline}
    />
  );
}
