import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/app/DashboardShell";
import { LandingNav } from "@/components/marketing/LandingNav";
import { NotFoundContent } from "@/components/i18n/NotFoundContent";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/ui-cookies";

// Shared 404 renderer. Picks chrome by CONTEXT so a not-found "stays where you
// are":
//   • dashboard chrome (sidebar + panel) for app-area paths, or for any
//     signed-in visitor;
//   • landing chrome (nav + framed page) for public paths hit while signed-out.
//
// Renders the 404 body INLINE — it deliberately does NOT call notFound(). Calling
// notFound() from the [lang] catch-all trips a Next 16 dev-only performance.measure
// crash (vercel/next.js#86060); rendering directly sidesteps it. Trade-off: the
// catch-all returns 200 rather than 404 for unmatched URLs (acceptable — real
// resource-missing 404s still go through notFound() inside the (app) group).
export async function NotFoundView({
  forceDashboard = false,
}: {
  forceDashboard?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const dashboardChrome = forceDashboard || !!user;

  if (dashboardChrome) {
    const initialIsCollapsed =
      (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
    return (
      <DashboardShell initialIsCollapsed={initialIsCollapsed}>
        <div className="flex flex-col items-center gap-8 px-6 pt-[12vh] text-center">
          <NotFoundContent recovery="dashboard" />
        </div>
      </DashboardShell>
    );
  }

  // Landing chrome — the marketing nav (logo + links + language menu) floating
  // over the framed page, with the 404 body centered. Direction is inherited
  // from <html dir>; strings come from the dictionary via the child components.
  return (
    <main>
      <div aria-hidden className="fixed inset-0 -z-[2] bg-[var(--tq-panel)]" />
      <LandingNav isAuthed={false} />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center gap-8 border-x border-[var(--tq-border-hairline)] px-6 text-center">
        <NotFoundContent recovery="home" />
      </div>
    </main>
  );
}
