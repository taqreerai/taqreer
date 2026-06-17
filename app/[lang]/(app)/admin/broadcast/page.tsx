// Admin > Broadcast (server). Gates on admin, fetches the recipient count
// (every user) + the broadcast history (AdminBroadcast rows, pruned after 30
// days by the notifications-cleanup cron), and renders the wired client.

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { BroadcastClient } from "@/components/admin/BroadcastClient";
import type { BroadcastItem } from "@/lib/admin/mock";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  await requireAdminPage();

  const [recipientCount, rows] = await Promise.all([
    prisma.user.count(),
    prisma.adminBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        message: true,
        recipientCount: true,
        createdAt: true,
      },
    }),
  ]);

  const history: BroadcastItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    sentAt: r.createdAt.toISOString().slice(0, 10),
    recipients: r.recipientCount,
  }));

  return <BroadcastClient recipientCount={recipientCount} initialHistory={history} />;
}
