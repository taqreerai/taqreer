import { cookies } from "next/headers";
import { DashboardShell } from "@/components/app/DashboardShell";

// Must match `sidebarCookieKey` in DashboardShell.tsx — the client
// writes the cookie when the user toggles the sidebar, so SSR can
// read it here and render the right initial state. Without this we
// hard-coded `initialIsCollapsed={false}` and the sidebar would
// snap wide on entering create + snap back on returning to the
// dashboard, jolting the main content horizontally.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

// The create flow used to render its own horizontal step-pill bar
// at the top of the page; that's now the responsibility of every
// page's <CreateShell currentStep="..."> wrapper (top progress strip
// + left-rail stepper). Layout's only job is to provide the
// dashboard chrome (main sidebar + header) and a directional
// page-container so child pages inherit `dir="rtl"`.
export default async function CreateLayout({
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
