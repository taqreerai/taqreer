import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

// Identical to /create/layout.tsx + /enhance/layout.tsx + /mimic/layout.tsx —
// the four create-flow entry points all live OUTSIDE the `(app)` route
// group (so they're not auto-wrapped by `(app)/layout.tsx`) but each
// mounts its own `DashboardShell` here. Result: same sidebar + header
// chrome the rest of the authed area uses, while keeping the create
// flows in their own URL space (`/create`, `/enhance`, `/mimic`,
// `/datasheet`) without inheriting any dashboard-specific layout
// padding from the route group.
//
// Must match `sidebarCookieKey` in DashboardShell.tsx — SSR reads the
// cookie here so the sidebar renders at the user's preferred state
// (collapsed / expanded) on first paint, no expand-then-collapse flash
// when navigating between create flows.
//
// Auth gate: see /create/layout.tsx for the rationale — same
// `getUser()` round-trip pattern in all four create-flow layouts
// because they live outside the `(app)` route group.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function DatasheetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/datasheet");
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
