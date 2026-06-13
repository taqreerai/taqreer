"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { dateFnsLocale } from "@/lib/i18n/date";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { planLabel } from "@/lib/plan";

// Shared plan banner — the SAME card on /settings (default Upgrade CTA) and
// /billing (pass `action` to swap in Cancel/Resume, user direction
// 2026-06-13). Reads the SAME credit store as the sidebar avatar ring and the
// profile-menu breakdown - the surfaces can never disagree, and all tick live
// on the credit.balance.changed broadcast. Renders nothing until the first
// balance fetch lands (matches the page's previous fetch-gated render).
export function PlanUsage({
  action,
  // Replaces the default "renews {date} · billed {cadence}" sub-line.
  // /billing passes its cancel-aware copy ("ends on {date}") here.
  renewalNote,
}: { action?: ReactNode; renewalNote?: ReactNode } = {}) {
  const dict = useDict();
  const { locale } = useLocale();
  const credits = useCreditBalance();
  if (!credits) return null;

  const { balance, capacity, plan, cadence } = credits;
  const used = Math.max(0, capacity - balance.total);
  const percentage =
    capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const planName = planLabel(dict.components.planUsage, plan);
  const renewalDate = balance.allotmentResetAt
    ? new Date(balance.allotmentResetAt)
    : null;
  // Cadence pill + "billed monthly/yearly" hint (labels live under the
  // billing dict). Null cadence (free / no sub) → neither renders.
  const tb = dict.components.billing;
  const cadenceLabel = cadence === "yearly" ? tb.yearly : tb.monthly;
  const cadenceHint = cadence === "yearly" ? tb.yearlyHint : tb.monthlyHint;

  return (
    <section>
      {/* Full-width usage bar under a header row; the renewal date sits
          where the usage caption used to (user direction 2026-06-11). */}
      <div className="plan-banner p-5 relative overflow-hidden">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-[24px] font-bold text-on-surface">{dict.components.planUsage.plan.replace("{plan}", planName)}</h3>
              <span className="badge-purple">{planName}</span>
              {cadence ? (
                <span className="rounded-full bg-overlay-soft px-2 py-0.5 text-[10px] font-medium text-muted">
                  {cadenceLabel}
                </span>
              ) : null}
            </div>
            <p className="text-muted text-sm">
              {renewalNote ??
                (renewalDate
                  ? `${dict.components.planUsage.renewalDate.replace("{date}", format(renewalDate, "d MMMM", { locale: dateFnsLocale(locale) }))}${cadence ? ` · ${cadenceHint}` : ""}`
                  : dict.components.planUsage.noRenewal)}
            </p>
          </div>
          {action ? (
            <div className="shrink-0">{action}</div>
          ) : (
            <Link className="btn-gradient shrink-0 px-8 py-3 no-underline" href={localizedHref("/plans", locale)}>
              {dict.components.planUsage.upgrade}
            </Link>
          )}
        </div>
        <div className="relative z-10 mt-4">
          <div className="progress-track mb-2 w-full">
            <div className="progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>{dict.components.planUsage.usedPercent.replace("{percentage}", String(percentage))}</span>
            <span dir="ltr" className="tabular-nums">
              {dict.components.planUsage.creditsLeft
                .replace("{count}", formatCredits(balance.total))
                .replace("{limit}", formatCredits(capacity))}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
