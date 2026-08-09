// Delayed first-month retention gift (2026-08-09).
//
// Fired by queueFirstMonthGiftCheck (lib/credits/first-month-gift.ts)
// when a paid first-month subscriber's balance drops below the
// cheapest generation. The 10-minute sleep is deliberate product
// feel: an instant grant at the exact second the credits die reads as
// a vending machine; a short delay reads as a considered gesture.
// Durability is why this lives in Inngest at all - a setTimeout in
// next-server would silently drop pending gifts on every deploy.
//
// Grant and email are SEPARATE memoized steps: an email retry can
// never re-grant (grant step's result is cached), and a grant can
// never be lost to an email hiccup. The grant itself is idempotent
// via the firstmonth-gift:<userId> sourceKey either way.

import { inngest } from "@/inngest/client";
import {
  FIRST_MONTH_GIFT_EVENT,
  grantFirstMonthGift,
  sendFirstMonthGiftEmail,
} from "@/lib/credits/first-month-gift";

export const firstMonthGift = inngest.createFunction(
  {
    id: "credits-first-month-gift",
    name: "First-month gift: delayed 600-credit grant",
    retries: 2,
    triggers: [{ event: FIRST_MONTH_GIFT_EVENT }],
  },
  async ({ event, step }) => {
    const userId = (event.data as { userId?: string })?.userId;
    if (!userId) return { granted: 0, skipped: "no userId" };

    await step.sleep("feel-natural-delay", "10m");

    const granted = await step.run("grant", () => grantFirstMonthGift(userId));
    if (granted > 0) {
      await step.run("email", () => sendFirstMonthGiftEmail(userId));
    }
    return { granted };
  },
);
