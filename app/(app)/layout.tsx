import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: 'لوحة التحكم | تقرير',
  description: 'إدارة مشاريعك وعروضك التقديمية',
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/auth/login?next=/dashboard");
  }

  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get("taqreer_sidebar_collapsed")?.value === "true";

  return <DashboardShell initialIsCollapsed={initialSidebarCollapsed}>{children}</DashboardShell>;
}
