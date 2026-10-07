import type { Metadata } from "next";
import { DashboardShell } from "@/components/app/DashboardShell";
import { PostHogIdentify } from "@/components/analytics/PostHogIdentify";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

// The deck studio/viewer route (/project/[projectId]) lives in its OWN route
// group, deliberately OUTSIDE the auth-gated (app) group. A completed deck can
// be opened by an anonymous "anyone with the link" public viewer, so this route
// must NOT blanket-redirect signed-out visitors to /login the way (app)/layout
// does — that redirect ran before the page and shadowed its public-view path.
//
// Access control is entirely the page's job: it calls
// resolveProjectAccess(projectId, "view") and notFound()s on any error. That
// helper is the security boundary — it rejects banned callers (403), hides the
// existence of private/unauthorized decks behind the same 404 (never leaks
// "wrong account" vs "not shared"), blocks explicitly-revoked users from the
// public-link fallback, and only grants anonymous view when the deck's
// publicAccessLevel is "view". This layout supplies chrome only.
//
// DashboardShell auto-detects the full-bleed, rail-less studio treatment from
// the /project pathname, so no props are needed. force-dynamic because the page
// reads auth cookies via resolveProjectAccess.
export const dynamic = "force-dynamic";

// Mirror the (app) layout's title so moving /project out of that group doesn't
// leak the marketing landing title onto deck pages/shared links.
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

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell>
      <PostHogIdentify />
      {children}
    </DashboardShell>
  );
}
