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
    router.push(`/api/projects/${projectId}/download`);
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.id} className="glass-card rounded-xl overflow-hidden group glow-hover transition-all duration-300">
              <div className="relative h-48 bg-surface-container-high">
                {project.thumbnail ? (
                  <img
                    alt={project.title}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    src={project.thumbnail}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-surface-variant">
                    <span className="material-symbols-outlined text-4xl text-outline-variant">image</span>
                  </div>
                )}
                <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur px-2 py-1 rounded text-xs font-label-sm text-primary border border-primary/20">
                  {projectTypeLabels[project.type] ?? project.type}
                </div>
              </div>
              <div className="p-4">
                <h4 className="font-headline-md text-[18px] font-semibold text-on-surface mb-1 truncate">
                  {project.title}
                </h4>
                <p className="text-xs text-on-surface-variant mb-4">
                  {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: ar })}
                </p>
                <div className="flex items-center justify-between border-t border-outline-variant/30 pt-3">
                  <div className="flex space-x-reverse space-x-2">
                    <button
                      aria-label="Download project"
                      className="text-on-surface-variant hover:text-primary transition-colors"
                      onClick={() => handleDownload(project.id)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">download</span>
                    </button>
                    <Link className="text-on-surface-variant hover:text-primary transition-colors" href={`/preview/${project.id}`}>
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </Link>
                  </div>
                  <button
                    aria-label="Open more actions"
                    className="text-on-surface-variant hover:text-on-surface transition-colors"
                    onClick={() => handleMoreClick(project.id)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-lg">more_vert</span>
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
