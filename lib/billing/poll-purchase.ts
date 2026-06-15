"use client";

// After a checkout confirms on the client, the Stripe SUBSCRIPTION webhook
// that actually grants the credits + fires the "credited" / "plan changed"
// notification arrives server-to-server a beat later (1-3s, sometimes more).
// The per-user realtime broadcast usually catches that grant and updates the
// UI in place, but it races the confirm and can be missed — which is why a
// fresh purchase sometimes needed a manual refresh to show the new plan,
// credits, and bell badge.
//
// This poll closes that gap: after a confirmed checkout we refetch the
// auth-gated credit + notification routes a few times until the grant lands
// (the plan or balance changes from the pre-grant baseline), or until a short
// deadline. It is idempotent with the realtime path — both just refetch the
// same stores and apply in place (realtime = in-place state, never a reload).

import { creditStore } from "@/lib/credits/store";
import { notificationStore } from "@/lib/notifications/store";

const INTERVAL_MS = 1500;
const DEADLINE_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the credit + notification stores until a just-completed purchase is
 * reflected (plan or balance changed), or the deadline passes. Safe to call
 * fire-and-forget; every refetch applies the latest server state in place, so
 * even if change-detection never trips (e.g. the webhook beat the baseline
 * read) the UI still ends up correct.
 */
export async function pollPurchaseSettled(): Promise<void> {
  if (typeof window === "undefined") return;

  // Baseline = state at confirm time (usually still pre-grant).
  await creditStore.refetch();
  const base = creditStore.getSnapshot();
  const basePlan = base?.plan ?? null;
  const baseTotal = base?.balance.total ?? null;

  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    await delay(INTERVAL_MS);
    await Promise.all([creditStore.refetch(), notificationStore.refetch()]);
    const now = creditStore.getSnapshot();
    if (now && (now.plan !== basePlan || now.balance.total !== baseTotal)) {
      return; // grant landed — stores are already updated in place
    }
  }
}
