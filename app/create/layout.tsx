import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

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
//
// ─── Auth gate ────────────────────────────────────────────────────
// The four create-flow layouts (/create, /enhance, /mimic, /datasheet)
// each carry their own `getUser()` round-trip + redirect because they
// live OUTSIDE the `(app)` route group, so `(app)/layout.tsx`'s gate
// never runs for them. API routes (POST /api/projects, POST /api/extract,
// POST /api/datasheet/parse) all check auth too, so an unauth visitor
// couldn't actually create data — but exposing the UI was confusing
// and felt unauthenticated. `getUser()` round-trips to Supabase so a
// forged / stale cookie can't slip past.
export default async function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/create");
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
