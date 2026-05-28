import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

// Mirrors app/create/layout.tsx exactly. The Enhance flow is a
// PARALLEL route tree (Phase 17.B) — same chrome (dashboard
// sidebar + header + RTL page container), same shell pattern, just
// a different URL namespace (/enhance/* instead of /create/*) so
// the user's address bar reads "تحسين" the entire way through.
//
// Each /enhance/* page renders <CreateShell currentStep="...">
// inside this layout, exactly like /create/* pages do. Stepper +
// progress strip are owned by CreateShell, not this layout.
//
// Auth gate: see /create/layout.tsx for the rationale — same
// `getUser()` round-trip pattern in all four create-flow layouts
// because they live outside the `(app)` route group.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function EnhanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/enhance");
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
