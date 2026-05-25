import { cookies } from "next/headers";
import { DashboardShell } from "@/components/app/DashboardShell";

// Mirror of app/enhance/layout.tsx — Phase 17.C parallel route tree.
// Same chrome (dashboard sidebar + header + RTL page container) as
// /create and /enhance; the URL namespace (/mimic/*) is the only
// thing different in the address bar.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function MimicLayout({
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
