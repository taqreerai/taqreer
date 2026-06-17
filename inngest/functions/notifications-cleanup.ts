// Daily TTL janitor: prune bell notifications + admin broadcasts 30 days after
// they were created, so the Notification + AdminBroadcast tables don't grow
// unbounded. The bell already caps the client list to 30 items; this enforces
// the same retention server-side. Idempotent - a no-op once the tail is gone.

import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const notificationsCleanup = inngest.createFunction(
  {
    id: "notifications-cleanup",
    name: "Notifications Cleanup (30-day TTL)",
    retries: 2,
    // 4am, staggered after credits-maintenance (3am).
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step, logger }) => {
    const cutoff = new Date(Date.now() - TTL_MS);

    const notifications = await step.run("prune-notifications", async () => {
      const { count } = await prisma.notification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    });

    const broadcasts = await step.run("prune-broadcasts", async () => {
      const { count } = await prisma.adminBroadcast.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    });

    logger.info("[notifications-cleanup] pruned old rows", {
      notifications,
      broadcasts,
      cutoff: cutoff.toISOString(),
    });
    return { notifications, broadcasts };
  },
);
