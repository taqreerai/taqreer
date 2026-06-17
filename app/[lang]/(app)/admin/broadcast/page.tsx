// Admin > Broadcast (server). Gates on admin, fetches the recipient count
// (every user) + the broadcast history (AdminBroadcast rows, pruned after 30
// days by the notifications-cleanup cron), and renders the wired client.
// Broadcasts are bilingual; the history shows the admin's own locale version.

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import { BroadcastClient } from "@/components/admin/BroadcastClient";
import type { BroadcastItem } from "@/lib/admin/mock";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  await requireAdminPage();
  const { lang } = await params;
  const isAr = lang === "ar";

  const [recipientCount, rows] = await Promise.all([
    prisma.user.count(),
    prisma.adminBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        titleEn: true,
        messageEn: true,
        titleAr: true,
        messageAr: true,
        recipientCount: true,
        createdAt: true,
      },
    }),
  ]);

  const history: BroadcastItem[] = rows.map((r) => ({
    id: r.id,
    title: isAr ? r.titleAr : r.titleEn,
    message: isAr ? r.messageAr : r.messageEn,
    sentAt: r.createdAt.toISOString().slice(0, 10),
    recipients: r.recipientCount,
  }));

  return (
    <BroadcastClient
      recipientCount={recipientCount}
      initialHistory={history}
      lang={isAr ? "ar" : "en"}
    />
  );
}
