import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: 'لوحة التحكم | تقرير',
  description: 'إدارة مشاريعك وعروضك التقديمية',
};

// Must match `sidebarCookieKey` in DashboardShell.tsx — the client
// writes the cookie when the user toggles the sidebar, so SSR can
// read it here and render the right initial state (no expand-then-
// collapse flash on navigation).
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // `getUser()` round-trips to Supabase auth so a forged / stale
  // cookie can't pass the protected-layout gate. `getSession()`
  // reads the cookie only (unverified).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/dashboard");
  }

  const cookieStore = await cookies();
  const initialIsCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <DashboardShell initialIsCollapsed={initialIsCollapsed}>
      {children}
    </DashboardShell>
  );
}
