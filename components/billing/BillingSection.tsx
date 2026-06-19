"use client";

// /plans page content (was /billing until the 2026-06-12 embedded-
// billing split). Three sections in order: Plan (summary), Change plan
// (landing-style pricing cards + the design-system monthly/yearly
// SegmentedToggle), Top-up packs. Purchases go to our embedded
// /checkout page; money ADMIN (cards, cancel/resume, dunning) lives on
// /billing (ManageBilling), receipts on /invoices.
//
// Reads the shared credit store for plan + balance, and
// /api/billing/summary for the subscription-mirror state (renewal /
// cancel dates).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { dateFnsLocale } from "@/lib/i18n/date";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { TIERS, TIER_ORDER, TOPUP_PACKS } from "@/lib/credits/cost";
import { SegmentedToggle } from "@/components/create/controls";
import { PlanUsage } from "@/components/app/PlanUsage";
import { normalizePlan, type KnownPlan } from "@/lib/plan";

type Cadence = "monthly" | "yearly";

type Summary = {
  plan: KnownPlan;
  hasBillingAccount: boolean;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  cadence: "monthly" | "yearly" | null;
};

// Per-month price shown on the cards (the yearly column shows the
// discounted per-month figure, matching the landing).
const YEARLY_PER_MONTH: Record<"plus" | "pro" | "max", number> = {
  plus: 13,
  pro: 27,
  max: 63,
};

// How many of the landing's 7 feature rows (credits + 6 features) are
// enabled per tier - mirrors TIERS in components/marketing/PricingTiers.
const FEATURES_ENABLED: Record<KnownPlan, number> = {
  free: 4,
  plus: 6,
  pro: 7,
  max: 7,
};

// "Pro" carries the landing's popular pill here too.
const POPULAR_TIER: KnownPlan = "pro";

export function BillingSection({
  // "modal" (UpgradeModal, 2026-06-12): plan cards only - no plan
  // summary, no top-up packs - and purchases go through onBuy (the
  // modal swaps to its embedded checkout step) instead of routing to
  // the /checkout page.
  variant = "page",
  onBuy,
  // Lowest tier that satisfies the caller's gate (UpgradeModal, CR
  // PR#57): tiers BELOW it render dimmed with a disabled CTA so a
  // user chasing a pro-gated feature can't buy plus and stay blocked.
  minTier,
}: {
  variant?: "page" | "modal";
  onBuy?: (lookupKey: string) => void;
  minTier?: KnownPlan | null;
} = {}) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const router = useRouter();
  const t = dict.components.billing;
  const pricing = dict.landing.pricing;
  const credits = useCreditBalance();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cadence, setCadence] = useState<Cadence>("yearly");
  const [busy, setBusy] = useState<string | null>(null);

  // Paid purchases go to our EMBEDDED checkout page (stays on
  // taqreer.ai); money admin is /billing (also ours - no Stripe pages).
  function buy(lookupKey: string) {
    if (onBuy) {
      onBuy(lookupKey);
      return;
    }
    setBusy(lookupKey);
    router.push(`${localizedHref("/checkout", locale)}?price=${lookupKey}`);
  }

  const loadSummary = useCallback(() => {
    fetch("/api/billing/summary", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => {
        if (d) setSummary(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Refetch the mirror in place on a realtime subscription.changed (cancel /
  // resume from another tab, webhook-driven dunning / renewal). Re-dispatched
  // as this DOM event by the notification store.
  useEffect(() => {
    const onChange = () => loadSummary();
    window.addEventListener("taqreer:subscription-changed", onChange);
    return () =>
      window.removeEventListener("taqreer:subscription-changed", onChange);
  }, [loadSummary]);

  const plan = summary ? summary.plan : credits ? normalizePlan(credits.plan) : "free";

  const currentIdx = TIER_ORDER.indexOf(plan);
  // The renewal date rides on the summary (the billing mirror), so it must
  // NOT wait on the credit store - gating on `credits` could blank the
  // renewal/ends-on line (and its cadence hint) while credits are still
  // loading (CR PR#58).
  const renewDate = summary?.currentPeriodEnd
    ? format(new Date(summary.currentPeriodEnd), "d MMMM", {
        locale: dateFnsLocale(locale),
      })
    : null;
  // Billing interval of the active paid subscription (null = free/none) →
  // a muted chip next to the tier badge + a "billed monthly/yearly" hint.
  // (Named subCadence to avoid colliding with the monthly/yearly TOGGLE
  // state `cadence` used by the change-plan cards below.)
  const subCadence = summary?.cadence ?? null;
  const cadenceHint = subCadence === "yearly" ? t.yearlyHint : t.monthlyHint;
  // Cancel-aware renewal line for the shared PlanUsage card (mirrors /billing).
  const planRenewalNote =
    summary?.cancelAtPeriodEnd && renewDate
      ? t.endsOn.replace("{date}", renewDate)
      : renewDate
        ? `${t.renews.replace("{date}", renewDate)}${subCadence ? ` · ${cadenceHint}` : ""}`
        : t.noRenewal;

  return (
    <div className="flex flex-col gap-10">
      {/* ── Plan ── the SAME shared card as /billing (user direction
          2026-06-14); the action slot is hidden since the change-plan cards
          sit directly below. */}
      {variant === "page" ? (
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">{t.planTitle}</h2>
        <PlanUsage hideAction renewalNote={planRenewalNote} />
      </section>
      ) : null}

      {/* ── Change plan ── */}
      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t.changePlan}</h2>
          {/* The design-system white animated toggle - same control as
              the landing's monthly/yearly switch. */}
          <SegmentedToggle<Cadence>
            options={[
              { value: "monthly", label: pricing.monthly },
              {
                value: "yearly",
                label: (
                  <>
                    {pricing.yearly}{" "}
                    {/* Solid blue chip + white text - same as landing. */}
                    <span className="-me-1.5 rounded-full bg-[var(--tq-purple)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {pricing.discount}
                    </span>
                  </>
                ),
              },
            ]}
            value={cadence}
            onChange={setCadence}
            ariaLabel={pricing.billingAria}
          />
        </div>

        {/* Landing-size pricing cards (same layout as the landing
            grid); only the CTAs differ: Current / Upgrade / Downgrade. */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {TIER_ORDER.map((tier, idx) => {
            const isCurrent = idx === currentIdx;
            const isUpgrade = idx > currentIdx;
            const isFree = tier === "free";
            // Below the caller's gate -> visible for context, not buyable.
            const belowGate =
              minTier != null && idx < TIER_ORDER.indexOf(minTier);
            const popular = tier === POPULAR_TIER;
            const copy = pricing.tiers[idx];
            const priceUsd = isFree
              ? 0
              : cadence === "yearly"
                ? YEARLY_PER_MONTH[tier as "plus" | "pro" | "max"]
                : TIERS[tier].priceUsd;
            const footnote =
              cadence === "yearly" && !isFree ? pricing.billedYearly : copy.footnote;
            const lookupKey = `tier_${tier}_${cadence}`;
            const featureLabels = [copy.credits, ...copy.features];
            return (
              <div
                key={tier}
                // Current plan = ONE clean accent border (not an outline ON TOP
                // of the hairline, which read as a doubled/muted extra border).
                className={`surface-card relative flex w-full flex-col rounded-2xl p-8 ${belowGate ? "opacity-50" : ""}`}
                style={isCurrent ? { borderColor: "var(--tq-purple)" } : undefined}
              >
                {popular && (
                  <div className="hero-stat-pill absolute -top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#fff" }} />
                    {pricing.mostPopular}
                  </div>
                )}

                <h3 className="mb-4 text-center text-xl font-medium">{copy.name}</h3>
                <p className="mb-8 h-10 whitespace-pre-line text-center text-sm text-muted">
                  {copy.description}
                </p>

                <div className="mb-8 flex-grow space-y-4">
                  {featureLabels.map((label, fi) => {
                    const enabled = fi < FEATURES_ENABLED[tier];
                    return (
                      <div
                        key={fi}
                        className={`flex items-center gap-2.5 whitespace-nowrap text-[13px] ${
                          enabled ? "" : "text-muted opacity-60"
                        }`}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 18,
                            color: enabled ? "var(--tq-violet)" : undefined,
                            opacity: enabled ? 1 : 0.5,
                          }}
                          aria-hidden
                        >
                          check
                        </span>
                        {label}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-auto text-center">
                  <div className="mb-2 flex items-end justify-center gap-1">
                    <span className="text-4xl font-bold tabular-nums" dir="ltr">
                      ${priceUsd}
                    </span>
                    {!isFree && <span className="mb-1 text-muted">{pricing.perMonth}</span>}
                  </div>
                  <div className="mb-6 text-xs text-muted">{footnote}</div>
                  {isCurrent ? (
                    <span className="block w-full rounded-full py-3 text-sm font-medium text-muted">
                      {t.current}
                    </span>
                  ) : isFree ? (
                    // Downgrade-to-Free = cancel the subscription on
                    // our /billing page (the portal is gone).
                    <button
                      type="button"
                      disabled={busy !== null || !summary?.hasBillingAccount}
                      onClick={() => router.push(localizedHref("/billing", locale))}
                      className="btn-pill block w-full py-3 text-sm disabled:opacity-50"
                    >
                      {t.downgrade}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null || belowGate}
                      onClick={() => buy(lookupKey)}
                      className={`block w-full py-3 text-sm disabled:opacity-50 ${
                        isUpgrade ? "btn-gradient" : "btn-pill"
                      }`}
                    >
                      {busy === lookupKey ? t.loading : isUpgrade ? t.upgrade : t.downgrade}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Top-up packs ── subscriber refills only (user direction
          2026-06-12); Free accounts see the cards muted with a
          "pick a plan first" hint, and the checkout API refuses topup
          lookupKeys for free plans server-side. */}
      {variant === "page" ? (
      <section>
        <h2 className="text-lg font-semibold text-foreground">{t.packsTitle}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {plan === "free" ? t.topupSubscribersOnly : t.packsHint}
        </p>
        <div
          className={`mt-4 grid gap-6 md:grid-cols-2 xl:grid-cols-4 ${plan === "free" ? "opacity-60" : ""}`}
          dir={dir}
        >
          {TOPUP_PACKS.map((pack) => {
            const lookupKey = `topup_${pack.key}`;
            return (
              <div
                key={pack.key}
                className="surface-card flex flex-col items-center gap-1 rounded-2xl p-8"
              >
                <span className="text-3xl font-bold text-foreground tabular-nums" dir="ltr">
                  {formatCredits(pack.credits)}
                </span>
                <span className="text-sm font-bold text-muted" dir="ltr">
                  ${pack.priceUsd}
                </span>
                <button
                  type="button"
                  disabled={busy !== null || plan === "free"}
                  onClick={() => buy(lookupKey)}
                  className="btn-pill mt-4 w-full py-2.5 text-sm disabled:opacity-50"
                >
                  {busy === lookupKey ? t.loading : t.buy}
                </button>
              </div>
            );
          })}
        </div>
      </section>
      ) : null}
    </div>
  );
}
