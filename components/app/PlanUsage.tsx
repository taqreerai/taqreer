import { format } from "date-fns";
import { ar } from "date-fns/locale";
import Link from "next/link";

type PlanUsageProps = {
  plan: string;
  usageCount: number;
  limit: number;
  renewalDate: Date | null;
};

const planNames: Record<string, string> = {
  free: "مجاني",
  plus: "بلس",
  pro: "احترافي",
};

export function PlanUsage({ plan, usageCount, limit, renewalDate }: PlanUsageProps) {
  const percentage = limit > 0 ? Math.min(100, Math.round((usageCount / limit) * 100)) : 0;
  const planName = planNames[plan] ?? plan;

  return (
    <section>
      <div className="plan-banner p-8 flex flex-col md:flex-row items-center justify-between relative overflow-hidden">
        <div className="absolute -right-[60px] -top-[60px] h-[250px] w-[250px] rounded-full bg-primary/15 blur-[30px]" />

        <div className="w-full md:w-1/2 mb-6 md:mb-0 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-[24px] font-bold text-on-surface">الخطة {planName}</h3>
            <span className="badge-purple">{planName}</span>
          </div>
          <p className="text-muted mb-4 text-sm">استخدام العروض التقديمية هذا الشهر</p>
          <div className="progress-track mb-2">
            <div className="progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>تم استخدام {percentage}%</span>
            <span>{usageCount} / {limit} عرضًا</span>
          </div>
        </div>

        <div className="flex flex-col items-end space-y-3 relative z-10">
          <Link className="btn-gradient px-8 py-3 no-underline" href="/#pricing">
            ترقية الخطة
          </Link>
          <span className="text-muted text-xs">
            {renewalDate ? `تاريخ التجديد: ${format(renewalDate, "d MMMM", { locale: ar })}` : "لا يوجد تاريخ تجديد"}
          </span>
        </div>
      </div>
    </section>
  );
}
