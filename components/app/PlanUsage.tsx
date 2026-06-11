"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { dateFnsLocale } from "@/lib/i18n/date";

type PlanUsageProps = {
  plan: string;
  usageCount: number;
  limit: number;
  renewalDate: Date | null;
};

export function PlanUsage({ plan, usageCount, limit, renewalDate }: PlanUsageProps) {
  const dict = useDict();
  const { locale } = useLocale();
  const percentage = limit > 0 ? Math.min(100, Math.round((usageCount / limit) * 100)) : 0;
  const planNames: Record<string, string> = {
    free: dict.components.planUsage.free,
    plus: dict.components.planUsage.plus,
    pro: dict.components.planUsage.pro,
  };
  const planName = planNames[plan] ?? plan;

  return (
    <section>
      <div className="plan-banner p-5 flex flex-col md:flex-row items-center justify-between relative overflow-hidden">
        <div className="w-full md:w-1/2 mb-6 md:mb-0 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-[24px] font-bold text-on-surface">{dict.components.planUsage.plan.replace("{plan}", planName)}</h3>
            <span className="badge-purple">{planName}</span>
          </div>
          <p className="text-muted mb-4 text-sm">{dict.components.planUsage.usageThisMonth}</p>
          <div className="progress-track mb-2">
            <div className="progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>{dict.components.planUsage.usedPercent.replace("{percentage}", String(percentage))}</span>
            <span>{dict.components.planUsage.usageCount.replace("{count}", String(usageCount)).replace("{limit}", String(limit))}</span>
          </div>
        </div>

        <div className="flex flex-col items-end space-y-3 relative z-10">
          <Link className="btn-gradient px-8 py-3 no-underline" href="/#pricing">
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
