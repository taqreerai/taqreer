"use client";

import { DashboardEmptyState, DashboardWidget, DashboardWidgetHeader } from "@/components/app/DashboardWidget";

type Template = {
  id: string;
  title: string;
  thumbnailUrls: string[];
  category: string;
};

export function MyTemplates({ templates }: { templates: Template[] }) {
  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="قوالبي" href="/templates" />

      {templates.length === 0 ? (
        <DashboardEmptyState
          icon="dashboard_customize"
          title="لا توجد قوالب محفوظة"
          description="عند حفظ عرض كقالب، سيظهر هنا لتستخدمه في عروضك القادمة."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((template) => {
            const thumbnail = template.thumbnailUrls[0] ?? null;

            return (
              <div key={template.id} className="glass-card rounded-[14px] overflow-hidden group">
                <div className="relative h-[88px] tq-thumbnail">
                  {thumbnail ? (
                    <img
                      alt={template.title}
                      src={thumbnail}
                      className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-[26px] text-muted/25">add_photo_alternate</span>
                    </div>
                  )}

                  <div className="absolute top-2 right-2">
                    <span className="badge-purple">{template.category}</span>
                  </div>

                  <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="btn-gradient px-3 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      استخدم
                    </button>
                  </div>
                </div>

                <div className="px-3 py-2.5">
                  <h4 className="text-[13px] font-semibold text-white truncate leading-snug">{template.title}</h4>
                  <p className="text-[11px] text-muted mt-0.5">{template.category}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardWidget>
  );
}
