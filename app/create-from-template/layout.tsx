import { cookies } from "next/headers";
import { DashboardShell } from "@/components/app/DashboardShell";

// Parallel route tree to /create, dedicated to the "use this template"
// flow. Kept entirely separate from /create on user direction
// (2026-05-22) so the normal 3-step create flow stays byte-identical
// to its pre-Phase-D shape. See seed-from-template.ts for the entry
// path: TemplateLightbox / TemplateActionsMenu fires seedFromTemplate
// which hydrates sessionStorage + routes here.
//
// Layout shape mirrors /create/layout.tsx — same dashboard chrome
// (sidebar + header) + the rtl page-container — because the visual
// rhythm of the two flows should feel like the same room, not two
// different products.

const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function CreateFromTemplateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const initialIsCollapsed =
    cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <DashboardShell initialIsCollapsed={initialIsCollapsed}>
      <div className="page-container" dir="rtl">
        {children}
      </div>
    </DashboardShell>
  );
}
