"use client";

// Settings → Billing section (billing plan Phase B). The production
// form of the /lab/billing showcase section 7: plan summary, the
// monthly/yearly change-plan table (→ Stripe Checkout), top-up packs
// (→ Checkout), Manage subscription (→ Stripe Portal), and the
// past_due dunning banner. All money management is Stripe-hosted; this
// surface only opens the right hosted page.
//
// Reads the shared credit store for plan + balance, and
// /api/billing/summary for the subscription-mirror state (renewal /
// cancel dates, dunning status).

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { dateFnsLocale } from "@/lib/i18n/date";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { TIERS, TIER_ORDER, TOPUP_PACKS } from "@/lib/credits/cost";
import { normalizePlan, type KnownPlan } from "@/lib/plan";

type Cadence = "monthly" | "yearly";

type Summary = {
  plan: KnownPlan;
  hasBillingAccount: boolean;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

// Per-month price shown on the cards (the yearly column shows the
// discounted per-month figure, matching the landing).
const YEARLY_PER_MONTH: Record<"plus" | "pro" | "max", number> = {
  plus: 13,
  pro: 27,
  max: 63,
};

export function BillingSection() {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.components.billing;
  const credits = useCreditBalance();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/billing/summary", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => {
        if (live && d) setSummary(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const plan = summary ? summary.plan : credits ? normalizePlan(credits.plan) : "free";
  const planNames: Record<string, string> = {
    free: dict.components.planUsage.free,
    plus: dict.components.planUsage.plus,
    pro: dict.components.planUsage.pro,
    max: dict.components.planUsage.max,
  };

  async function go(path: string, body?: unknown, key?: string) {
    setBusy(key ?? path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (data?.url) window.location.href = data.url;
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  }

  const currentIdx = TIER_ORDER.indexOf(plan);
  const renewDate =
    summary?.currentPeriodEnd && credits
      ? format(new Date(summary.currentPeriodEnd), "d MMMM", {
          locale: dateFnsLocale(locale),
        })
      : null;

  return (
    <div className="settings-card surface-card rounded-xl">
      <h2 className="settings-card-title">{t.title}</h2>
      <div className="settings-divider" />

      {/* Dunning banner */}
      {summary?.status === "past_due" ? (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{
            background: "var(--tq-status-warn-bg)",
            borderColor: "var(--tq-status-warn-border)",
          }}
        >
          <span className="flex items-center gap-2 text-sm text-foreground">
            <span className="material-symbols-outlined text-[var(--tq-status-warn-text)]" style={{ fontSize: 16 }}>
              credit_card_off
            </span>
            {t.pastDue}
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => go("/api/stripe/portal", undefined, "portal")}
            className="btn-pill shrink-0 px-4 py-1.5 text-xs"
          >
            {t.pastDueCta}
          </button>
        </div>
      ) : null}

      {/* Plan summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {dict.components.planUsage.plan.replace("{plan}", planNames[plan] ?? plan)}
            <span className="badge-purple">{planNames[plan] ?? plan}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {summary?.cancelAtPeriodEnd && renewDate
              ? t.endsOn.replace("{date}", renewDate)
              : renewDate
                ? t.renews.replace("{date}", renewDate)
                : t.noRenewal}
          </p>
          {credits ? (
            <p className="mt-2 text-xs text-muted tabular-nums" dir="ltr">
              {dict.components.planUsage.creditsLeft
                .replace("{count}", formatCredits(credits.balance.total))
                .replace("{limit}", formatCredits(credits.capacity))}
            </p>
          ) : null}
        </div>
        {summary?.hasBillingAccount ? (
          <div className="text-end">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => go("/api/stripe/portal", undefined, "portal")}
              className="btn-pill px-4 py-2 text-sm"
            >
              {busy === "portal" ? t.loading : t.manage}
            </button>
            <p className="mt-1.5 max-w-[180px] text-[10px] leading-relaxed text-muted">
              {t.manageHint}
            </p>
          </div>
        ) : null}
      </div>

      {/* Change-plan table with the monthly/yearly toggle */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{t.changePlan}</p>
          <div className="flex items-center gap-0.5 rounded-full bg-[var(--tq-surface)] p-0.5 text-xs">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCadence(c)}
                className={`rounded-full px-3 py-1 transition-colors ${
                  cadence === c
                    ? "bg-foreground/10 font-medium text-foreground"
                    : "text-muted"
                }`}
              >
                {c === "monthly" ? t.monthly : t.yearly}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIER_ORDER.map((tier, idx) => {
            const isCurrent = idx === currentIdx;
            const isUpgrade = idx > currentIdx;
            const isFree = tier === "free";
            const priceUsd =
              isFree
                ? 0
                : cadence === "yearly"
                  ? YEARLY_PER_MONTH[tier as "plus" | "pro" | "max"]
                  : TIERS[tier].priceUsd;
            const lookupKey = `tier_${tier}_${cadence}`;
            return (
              <div
                key={tier}
                className={`flex flex-col items-center gap-0.5 rounded-xl border p-4 ${
                  isCurrent
                    ? "border-[var(--tq-purple)] bg-[var(--tq-card)]"
                    : "border-[var(--tq-border-hairline)] bg-[var(--tq-card)]"
                }`}
              >
                <span className="text-sm font-bold text-foreground">{planNames[tier]}</span>
                <span className="text-lg font-bold text-foreground tabular-nums" dir="ltr">
                  ${priceUsd}
                  <span className="text-[10px] font-normal text-muted">{t.perMonth}</span>
                </span>
                <span className="text-[10px] text-muted" dir="ltr">
                  {formatCredits(
                    isFree ? TIERS.free.signupGrant : TIERS[tier].monthlyAllotment,
                  )}{" "}
                  {isFree ? t.creditsOnce : t.creditsMo}
                </span>
                {isCurrent ? (
                  <span className="mt-2 w-full rounded-full py-1.5 text-center text-xs font-medium text-muted">
                    {t.current}
                  </span>
                ) : isFree ? (
                  // Downgrade-to-Free happens by cancelling in the portal.
                  <button
                    type="button"
                    disabled={busy !== null || !summary?.hasBillingAccount}
                    onClick={() => go("/api/stripe/portal", undefined, "portal")}
                    className="btn-pill mt-2 w-full py-1.5 text-xs disabled:opacity-50"
                  >
                    {t.downgrade}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      go("/api/stripe/checkout", { lookupKey }, lookupKey)
                    }
                    className={`mt-2 w-full py-1.5 text-xs ${isUpgrade ? "btn-gradient" : "btn-pill"}`}
                  >
                    {busy === lookupKey ? t.loading : isUpgrade ? t.upgrade : t.downgrade}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top-up packs */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-foreground">{t.packsTitle}</p>
        <p className="mt-0.5 text-xs text-muted">{t.packsHint}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOPUP_PACKS.map((pack) => {
            const lookupKey = `topup_${pack.key}`;
            return (
              <div
                key={pack.key}
                className="flex flex-col items-center gap-1 rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-4"
              >
                <span className="text-lg font-bold text-foreground tabular-nums" dir="ltr">
                  {formatCredits(pack.credits)}
                </span>
                <span className="text-xs font-bold text-muted" dir="ltr">
                  ${pack.priceUsd}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => go("/api/stripe/checkout", { lookupKey }, lookupKey)}
                  className="btn-pill mt-2 w-full py-1.5 text-xs"
                >
                  {busy === lookupKey ? t.loading : t.buy}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
