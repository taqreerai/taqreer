"use client";

// Client-side credit balance store - the ONE source every credit surface
// reads (sidebar avatar ring, profile-popup breakdown, settings card,
// GenerateSplitButton estimates), so they can never show different
// numbers. Same subscribe/notify shape as lib/notifications/store.ts.
//
// Data flow:
//   1. Hydrate from GET /api/credits on first consumer mount.
//   2. Live updates ride the EXISTING per-user Supabase channel - the
//      notification store owns that channel and re-dispatches
//      `credit.balance.changed` as a DOM CustomEvent (same decoupling
//      as share.revoked). The event is POINTER-ONLY (the user topic is
//      a public broadcast channel, so the balance never rides the
//      socket); this store reacts by refetching the auth-gated API and
//      applying the result in place (realtime = in-place state, never
//      router.refresh).

import { useEffect, useSyncExternalStore } from "react";
import type { KnownPlan } from "@/lib/plan";
import type { TierDisplayNumber } from "@/lib/credits/pricing-tokens";

export const CREDIT_BALANCE_EVENT = "taqreer:credit-balance-changed";

// One active generation preset, DB-driven, as the picker needs it: its cost
// (base + per-slide) and the lowest tier that unlocks it (null = ungated).
export type CreditPreset = {
  key: string;
  label: string;
  thinking: boolean;
  // Adaptive-thinking effort tier (null when thinking is off). Drives the
  // 3-level design-quality chip in the picker (draft / standard / premium);
  // the boolean alone can't tell effort low from medium.
  effort: string | null;
  baseCredits: number;
  perSlideCredits: number;
  gateTier: KnownPlan | null;
};

export type CreditRecentEvent = {
  id: string;
  eventType: string;
  amount: number;
  metadata: unknown;
  createdAt: string;
};

export type CreditData = {
  plan: string;
  // Superuser: the chrome shows an "Admin" chip instead of the plan/credit
  // UI, and the generation picker treats every preset as unlocked.
  isAdmin?: boolean;
  // Region-limited free account: the only preset it may run (null = tier presets).
  regionPreset?: string | null;
  // The preset this account runs on (region or FREE_HAIKU_ALL); picker only.
  freePreset?: string | null;
  // One-time deck unlocks this account bought (unlock sheet, repeat-buyer line).
  deckPurchases?: number;
  // Region-limited free account: one-time unlocks use the regional price.
  regionPricing?: boolean;
  // Per-run slide ceiling for the user's tier (free = 10; admin = system cap).
  // The create/mimic/datasheet slide steppers cap their max at this value.
  slideCap: number;
  // Flows the tier can't generate with -> the lowest tier that unlocks each
  // (absent on a stale cached payload -> treated as nothing locked).
  lockedFlows?: Partial<Record<string, string>>;
  // Billing interval of the active paid subscription (null = free/none) →
  // drives the plan banner's monthly/yearly pill.
  cadence: "monthly" | "yearly" | null;
  balance: {
    total: number;
    subscription: number;
    topup: number;
    monthlyAllotment: number;
    allotmentResetAt: string | null;
  };
  // The ring denominator: this cycle's grant + active pack principal.
  capacity: number;
  // Active presets for the generation picker (admin Settings -> DB). Absent
  // presets are inactive and don't render; costs/gating here match the charge.
  presets: CreditPreset[];
  // The server's default preset key (what an inactive/retired selection is
  // coerced to), so the picker never highlights a dead key.
  defaultPresetKey: string;
  // Credits per generated image (images-mode surcharge; DB admin knob).
  // Absent on a stale cached payload -> client falls back to the bundled
  // IMAGE_CREDITS_PER_IMAGE constant.
  imageCredits?: number;
  // Per-tier display numbers for the in-app plan cards (BillingSection): the
  // free signup grant or a paid monthly allotment, plus the slide cap. Filled
  // into the {credits}/{slides} dict tokens so the cards track admin Settings.
  tierNumbers: TierDisplayNumber[];
  // Live Stripe prices (monthly + per-month-when-yearly) per tier for the
  // in-app plan cards, so they show the actual charge, not a literal.
  tierPrices: { plan: string; monthly: number; yearly: number }[];
  // Live top-up packs (Stripe by lookup_key, catalog fallback). Optional so
  // a stale cached payload degrades to the bundled TOPUP_PACKS constant.
  topupPacks?: { key: string; credits: number; priceUsd: number }[];
  recent: CreditRecentEvent[];
};

type Listener = () => void;

class CreditStore {
  private data: CreditData | null = null;
  private listeners = new Set<Listener>();
  private hydrating = false;
  private hydrated = false;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener(CREDIT_BALANCE_EVENT, () => {
        // Pointer-only signal: refetch the auth-gated route. Debounced
        // so a burst of settles costs one fetch.
        this.scheduleRefetch();
      });
      window.addEventListener("focus", () => {
        // Heal the signed-out-at-load case: a page mounted with an
        // invalid session hydrates to null (401), and signing in
        // usually happens in another tab or via a redirect - so
        // regaining focus is the moment to retry. Bounded: a no-op
        // once data has ever landed, so normal sessions never pay a
        // focus-driven fetch. (2026-08-30: without this, Generate
        // silently swallowed clicks after a mid-session login - the
        // `!credits` guard in GenerateSplitButton held forever.)
        if (this.data === null) this.scheduleRefetch();
      });
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private scheduleRefetch(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      void this.refetch();
    }, 250);
  }

  async refetch(): Promise<void> {
    try {
      const res = await fetch("/api/credits", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as CreditData;
      this.data = data;
      // Any successfully applied payload counts as hydration, whichever
      // path fetched it (consumer mount, balance event, focus retry) -
      // so a later ensureHydrated never issues a redundant fetch after
      // e.g. the focus listener already healed a failed first load
      // (CR PR #197). A failure never clears an existing latch.
      this.hydrated = true;
      this.emit();
    } catch {
      /* network blip - last snapshot stays */
    }
  }

  ensureHydrated(): void {
    if (this.hydrated || this.hydrating) return;
    this.hydrating = true;
    // `hydrated` latches inside refetch's SUCCESS path only. Pre-fix it
    // latched here in a `finally` regardless of outcome, so a 401 during
    // a signed-out load left data null FOREVER (no consumer ever
    // refetched) - the Generate button then silently swallowed clicks
    // after the user signed in (found 2026-08-30 e2e-testing
    // /ar/enhance). A failed attempt now leaves `hydrated` false so the
    // next consumer mount (or the focus listener above) retries;
    // `hydrating` still dedupes concurrent mounts.
    void this.refetch().finally(() => {
      this.hydrating = false;
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot = (): CreditData | null => this.data;
}

export const creditStore = new CreditStore();

const ssrSnapshot = (): CreditData | null => null;

/**
 * The shared balance. `null` until the first fetch resolves (or when
 * signed out) - consumers render their no-data state.
 */
export function useCreditBalance(): CreditData | null {
  const data = useSyncExternalStore(
    (listener) => creditStore.subscribe(listener),
    creditStore.getSnapshot,
    ssrSnapshot,
  );
  useEffect(() => {
    creditStore.ensureHydrated();
  }, []);
  return data;
}

/**
 * The per-run slide cap for the signed-in user's tier (free = 10), used as the
 * max on the create/mimic/datasheet slide steppers. Falls back to the free cap
 * (10) until the first /api/credits fetch resolves, so a free user can never
 * over-pick during the brief hydration window (calling it also triggers that
 * fetch via useCreditBalance).
 */
export function useSlideCap(): number {
  return useCreditBalance()?.slideCap ?? 10;
}

/**
 * The tier that unlocks `flow` when the signed-in user's plan can't generate
 * with it, else null. Null until /api/credits resolves, so a paying user
 * never sees a lock flash in.
 */
export function useFlowUnlockTier(flow: string): string | null {
  return useCreditBalance()?.lockedFlows?.[flow] ?? null;
}

/** Latin-digit thousands formatting (1,234) - brand rule: Latin numerals. */
export function formatCredits(n: number): string {
  return n.toLocaleString("en-US");
}
