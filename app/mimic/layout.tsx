import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

// Mirror of app/enhance/layout.tsx — Phase 17.C parallel route tree.
// Same chrome (dashboard sidebar + header + RTL page container) as
// /create and /enhance; the URL namespace (/mimic/*) is the only
// thing different in the address bar.
//
// Auth gate: see /create/layout.tsx for the rationale — same
// `getUser()` round-trip pattern in all four create-flow layouts
// because they live outside the `(app)` route group.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function MimicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/mimic");
  }

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
