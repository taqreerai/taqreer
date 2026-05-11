"use client";

import { usePathname } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";

const steps = [
  { step: 1, label: "رفع الملف", path: "/enhance/upload" },
  { step: 2, label: "مراجعة وإنشاء", path: "/enhance/review" },
];

function getCurrentStep(pathname: string) {
  if (pathname.startsWith("/enhance/review")) return 2;
  return 1;
}

export default function EnhanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentStep = getCurrentStep(pathname);

  return (
    <DashboardShell initialIsCollapsed={false}>
      <div className="page-container space-y-8" dir="rtl">
        <div className="glass-card rounded-xl px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {steps.map((item, index) => {
              const isActive = item.step === currentStep;
              const isComplete = item.step < currentStep;

              return (
                <div key={item.path} className="flex flex-1 items-center gap-3">
                  <div
                    className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors ${
                      isActive
                        ? "border-[#370BF4] bg-[#370BF4] text-white"
                        : isComplete
                          ? "border-[rgba(42,36,59,0.8)] text-[#9A94A8]"
                          : "border-[rgba(42,36,59,0.8)] text-[#9A94A8]"
                    }`}
                  >
                    {isComplete ? (
                      <span className="material-symbols-outlined text-[18px]">check</span>
                    ) : (
                      <span>{item.step}</span>
                    )}
                    <span>{item.label}</span>
                  </div>
                  {index < steps.length - 1 ? (
                    <span className="hidden h-px w-8 bg-[rgba(42,36,59,0.8)] md:block" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        {children}
      </div>
    </DashboardShell>
  );
}
