import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/ui-cookies";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const dict = await getDictionary(isLocale(lang) ? lang : "ar");
  return {
    title: dict.meta.dashboardTitle,
    description: dict.meta.dashboardDescription,
  };
}

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const supabase = await createClient();
  // `getUser()` round-trips to Supabase auth so a forged / stale
  // cookie can't pass the protected-layout gate. `getSession()`
  // reads the cookie only (unverified).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${lang}/login?next=/${lang}/dashboard`);
  }

  const cookieStore = await cookies();
  const initialIsCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  return (
    <DashboardShell initialIsCollapsed={initialIsCollapsed}>
      {children}
    </DashboardShell>
  );
}
