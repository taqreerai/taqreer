// Global 404 — handles two distinct flows with one file:
//
// 1. **Unmatched URLs** (e.g. `/banana`, `/dashboard/banana`,
//    `/projects/something-that-doesnt-exist`). Next.js has a quirk:
//    for URLs that don't match ANY route segment, it skips route-
//    group layouts (like `(app)/layout.tsx`) and renders the ROOT
//    `app/not-found.tsx` directly inside `app/layout.tsx`. That
//    bypassed the dashboard chrome — a logged-in user landing on
//    `/dashboard/banana` would see a bare 404 instead of the sidebar
//    + header. Solution: this file itself checks auth and manually
//    mounts `DashboardShell` for logged-in visitors, so unmatched
//    URLs still feel "inside the app".
//
// 2. **In-page `notFound()` calls** from `(app)/project/[id]` or
//    `(app)/preview/[id]` — those resolve to `(app)/not-found.tsx`,
//    NOT this file, because Next walks up from the matched segment
//    and `(app)/not-found.tsx` is closer. Chrome there is provided
//    by `(app)/layout.tsx` automatically.
//
// Why not a catch-all under `(app)`? A `(app)/[[...slug]]/page.tsx`
// catch-all would route unmatched URLs through `(app)/layout.tsx`,
// which redirects unauth visitors to `/login`. That changes
// behavior for unauth users on `/banana` (they'd lose the brand 404
// and get bounced to login). Doing the auth check HERE keeps both
// the auth and unauth experiences correct in one place.

import Link from "next/link";
import { cookies } from "next/headers";
import { DashboardShell } from "@/components/app/DashboardShell";
import { createClient } from "@/lib/supabase/server";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

// Must match `(app)/layout.tsx` so the manually-mounted DashboardShell
// here picks up the same sidebar-collapsed preference the user set.
const SIDEBAR_COOKIE = "tq_sidebar_collapsed";

export default async function NotFound() {
  // `getUser()` round-trips to Supabase auth — same gate `(app)/layout.tsx`
  // uses — so a forged / stale cookie can't fake a logged-in render.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The 404 body is identical in both cases (same icon + copy + inline
  // contact link) — only the recovery button + outer chrome differ.
  // `dir="rtl"` because the message is Arabic; the icon enforces its
  // own LTR direction internally via `.paragraph-write-icon`.
  const message = (
    <p className="max-w-md whitespace-pre-line text-base leading-relaxed text-white/70">
      {`هذه الصفحة ليست هنا.\nربما تجدها يومًا ما.\nوإن وجدتها، `}
      <Link
        href="/#contact"
        className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
      >
        أخبرنا كيف وصلت إليها
      </Link>
      .
    </p>
  );

  if (user) {
    // Logged-in: mount DashboardShell so the sidebar + header stay
    // visible. The shell already paints `dashboard-bg` and positions
    // content under the header — we just supply the inner block.
    const cookieStore = await cookies();
    const initialIsCollapsed =
      cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

    return (
      <DashboardShell initialIsCollapsed={initialIsCollapsed}>
        <div
          className="flex flex-col items-center gap-8 px-6 pt-[12vh] text-center"
          dir="rtl"
        >
          <ParagraphWriteIcon size={88} className="text-white" mode="break" />
          {message}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 text-sm font-medium text-white transition-colors hover:border-white/40 hover:bg-white/[0.08]"
          >
            العودة إلى لوحة التحكم
          </Link>
        </div>
      </DashboardShell>
    );
  }

  // Logged-out: standalone full-page brand 404. `dashboard-bg` paints
  // the aurora gradient + film-grain backdrop. The `relative z-10`
  // wrapper lifts content above the pseudo-element gradient (static
  // children would otherwise land BELOW the `::before/::after` layer
  // in the stacking context).
  return (
    <main
      className="dashboard-bg flex min-h-screen flex-col items-center justify-start gap-8 px-6 pt-[22vh] text-center"
      dir="rtl"
    >
      <div className="relative z-10 flex flex-col items-center gap-8">
        <ParagraphWriteIcon size={88} className="text-white" mode="break" />
        {message}
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 text-sm font-medium text-white transition-colors hover:border-white/40 hover:bg-white/[0.08]"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
