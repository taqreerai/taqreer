// /preview/[projectId] — BACK-COMPAT REDIRECT.
//
// Single-URL Studio (2026-06-07): generation now mounts directly at
// /project/[projectId] — DeckView renders one shell that flips from a disabled
// "generating" editor to the live editor in place, so there's no /preview →
// /project hop / remount on completion. This route is kept only so old links
// (bell notifications, share emails, bookmarks, the create flow's prior target)
// still resolve — it just forwards to /project, which serves every deck state.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PreviewRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/project/${projectId}`);
}
