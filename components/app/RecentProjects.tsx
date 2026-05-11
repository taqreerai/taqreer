"use client";

import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardEmptyState, DashboardWidget, DashboardWidgetHeader } from "@/components/app/DashboardWidget";

type Project = {
  id: string;
  title: string;
  type: string;
  updatedAt: Date | string;
  thumbnail: string | null;
};

const projectTypeLabels: Record<string, string> = {
  create: "عرض تقديمي",
  enhance: "تحسين",
  mimic: "محاكاة",
  custom: "مخصص",
  presentation: "عرض تقديمي",
  report: "تقرير",
};

export function RecentProjects({ projects }: { projects: Project[] }) {
  const router = useRouter();

  const handleDownload = (projectId: string) => {
    window.location.assign(`/api/projects/${projectId}/download`);
  };

  const handleMoreClick = (projectId: string) => {
    router.push(`/projects?project=${projectId}`);
  };

  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="أحدث المشاريع" href="/projects" />

      {projects.length === 0 ? (
        <DashboardEmptyState
          icon="add_circle"
          title="لا توجد مشاريع بعد"
          description="ابدأ بإنشاء أول عرض تقديمي وسيظهر هنا فور حفظه."
          action={{ label: "إنشاء مشروع", href: "/create" }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {projects.map((project) => (
            <div key={project.id} className="glass-card rounded-[14px] overflow-hidden group">
              <div className="relative h-[88px] tq-thumbnail">
                {project.thumbnail ? (
                  <img
                    alt={project.title}
                    src={project.thumbnail}
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-[26px] text-muted opacity-25">image</span>
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <span className="badge-purple">{projectTypeLabels[project.type] ?? project.type}</span>
                </div>
              </div>

              <div className="px-3 py-2.5">
                <h4 className="text-[13px] font-semibold text-white truncate leading-snug">{project.title}</h4>
                <p className="text-[11px] text-muted mt-0.5">
                  {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: ar })}
                </p>

                <div className="flex items-center justify-between mt-2.5 pt-2 tq-card-divider">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDownload(project.id)}
                      aria-label="تحميل"
                      className="btn-icon"
                    >
                      <span className="material-symbols-outlined text-[15px]">download</span>
                    </button>
                    <Link
                      href={`/preview/${project.id}`}
                      className="btn-icon inline-flex items-center justify-center"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit</span>
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleMoreClick(project.id)}
                    aria-label="المزيد"
                    className="btn-icon"
                  >
                    <span className="material-symbols-outlined text-[15px]">more_vert</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardWidget>
  );
}
