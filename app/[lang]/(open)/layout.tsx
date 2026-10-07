import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/app/DashboardShell";
import { PostHogIdentify } from "@/components/analytics/PostHogIdentify";
import { getAuthUser } from "@/lib/supabase/user";
import { ensureAppUser } from "@/lib/auth/ensure-app-user";
import { SignupConversion } from "@/components/analytics/SignupConversion";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

// The creation tools open to visitors (/create, /enhance, /mimic; route group
// "(open)", NOT "(studio)", which is the deck studio + public viewer and
// keeps its own layout). 2026-10-06, owner direction: a visitor sets the
// whole deck up first and signs up at the Create button (the draft survives
// the sign-up round trip, lib/create/guest-draft.ts). Signed-in users get the
// exact (app) chrome; visitors get the light guest frame. Nothing that costs
// money runs for a visitor: the page defers extraction + template setup
// until after sign-in.
export const dynamic = "force-dynamic";

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
    // A tool surface, not a landing page.
    robots: { index: false, follow: true },
  };
}

export default async function StudioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const user = await getAuthUser();

  if (!user) {
    return <DashboardShell guest>{children}</DashboardShell>;
  }

  // A visitor who signs up from the Create button lands HERE, not on the
  // dashboard: create the Prisma row + the signup grant like the dashboard
  // does. Then the (app) layout's gates: banned users go to the notice, role
  // drives the admin rail entry.
  const dbUser = await ensureAppUser(user, lang);
  if (dbUser.bannedAt) {
    redirect(`/${lang}/banned`);
  }

  return (
    <DashboardShell isAdmin={dbUser.role === "admin"}>
      <PostHogIdentify />
      {/* Google Ads sign-up conversion: fires once per new account. */}
      <SignupConversion />
      {children}
    </DashboardShell>
  );
}
