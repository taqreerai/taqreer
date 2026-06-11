"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { dateFnsLocale } from "@/lib/i18n/date";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";

// Settings-page plan banner. Reads the SAME credit store as the
// sidebar avatar ring and the profile-menu breakdown - the three
// surfaces can never disagree, and all tick live on the
// credit.balance.changed broadcast. Renders nothing until the first
// balance fetch lands (matches the page's previous fetch-gated render).
export function PlanUsage() {
  const dict = useDict();
  const { locale } = useLocale();
  const credits = useCreditBalance();
  if (!credits) return null;

  const { balance, capacity, plan } = credits;
  const used = Math.max(0, capacity - balance.total);
  const percentage =
    capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const planNames: Record<string, string> = {
    free: dict.components.planUsage.free,
    starter: dict.components.planUsage.starter,
    plus: dict.components.planUsage.plus,
    pro: dict.components.planUsage.pro,
  };
  const planName = planNames[plan] ?? plan;
  const renewalDate = balance.allotmentResetAt
    ? new Date(balance.allotmentResetAt)
    : null;

  return (
    <section>
      <div className="plan-banner p-5 flex flex-col md:flex-row items-center justify-between relative overflow-hidden">
        <div className="w-full md:w-1/2 mb-6 md:mb-0 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-[24px] font-bold text-on-surface">{dict.components.planUsage.plan.replace("{plan}", planName)}</h3>
            <span className="badge-purple">{planName}</span>
          </div>
          <p className="text-muted mb-4 text-sm">{dict.components.planUsage.creditUsage}</p>
          <div className="progress-track mb-2">
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

        <div className="flex flex-col items-end space-y-3 relative z-10">
          <Link className="btn-gradient px-8 py-3 no-underline" href={`${localizedHref("/", locale)}#pricing`}>
            {dict.components.planUsage.upgrade}
          </Link>
          <span className="text-muted text-xs">
            {renewalDate
              ? dict.components.planUsage.renewalDate.replace("{date}", format(renewalDate, "d MMMM", { locale: dateFnsLocale(locale) }))
              : dict.components.planUsage.noRenewal}
          </span>
        </div>
      </div>
    </section>
  );
}
