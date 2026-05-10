"use client";

import { DashboardEmptyState, DashboardWidget, DashboardWidgetHeader } from "@/components/app/DashboardWidget";
import { analytics } from "@/lib/posthog-client";

type Template = {
  id: string;
  title: string;
  thumbnailUrls: string[];
  category: string;
};

export function MyTemplates({ templates }: { templates: Template[] }) {
  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="قوالبي" />

      {templates.length === 0 ? (
        <DashboardEmptyState
          icon="dashboard_customize"
          title="لا توجد قوالب محفوظة"
          description="عند حفظ عرض كقالب، سيظهر هنا لتستخدمه في عروضك القادمة."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => {
            const thumbnail = template.thumbnailUrls[0] ?? null;

            return (
              <div key={template.id} className="glass-card rounded-xl overflow-hidden group glow-hover transition-all duration-300">
                <div className="relative h-48 bg-surface-container-high">
                  {thumbnail ? (
                    <img
                      alt={template.title}
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                      src={thumbnail}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface-variant">
                      <span className="material-symbols-outlined text-4xl text-outline-variant">
                        add_photo_alternate
                      </span>
                    </div>
                  )}

                  <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur px-2 py-1 rounded text-xs font-label-sm text-primary border border-primary/20">
                    {template.category}
                  </div>

                  <div className="template-overlay absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                    <button
                      className="btn-gradient px-6 py-2"
                      onClick={() => analytics.capture("template_used", { template_id: template.id, template_title: template.title })}
                      type="button"
                    >
                      استخدم
                    </button>
                  </div>
                </div>

                <div className="p-4">
                  <h4 className="font-headline-md text-[18px] font-semibold text-on-surface mb-1 truncate">{template.title}</h4>
                  <p className="text-xs text-on-surface-variant">{template.category}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardWidget>
  );
}
