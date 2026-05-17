import { DashboardShell } from "@/components/app/DashboardShell";

// The create flow used to render its own horizontal step-pill bar
// at the top of the page; that's now the responsibility of every
// page's <CreateShell currentStep="..."> wrapper (top progress strip
// + left-rail stepper). Layout's only job is to provide the
// dashboard chrome (main sidebar + header) and a directional
// page-container so child pages inherit `dir="rtl"`.
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell initialIsCollapsed={false}>
      <div className="page-container" dir="rtl">
        {children}
      </div>
    </DashboardShell>
  );
}
