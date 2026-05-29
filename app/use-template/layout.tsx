import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

// Mirror of app/mimic/layout.tsx — the "use as a template" forked Mimic
// flow (/use-template/[id] + /use-template/project/[id]) gets the same
// chrome as /mimic, /create, /enhance: dashboard sidebar + header + RTL
// page container. Without this layout the route fell back to the bare
// root layout (no sidebar/header).
//
// Auth gate: same getUser() round-trip the sibling create-flow layouts
// use because these routes live outside the `(app)` group.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function UseTemplateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/templates");
  }

  const cookieStore = await cookies();
  const initialIsCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <DashboardShell initialIsCollapsed={initialIsCollapsed}>
      <div className="page-container" dir="rtl">
        {children}
      </div>
    </DashboardShell>
  );
}
