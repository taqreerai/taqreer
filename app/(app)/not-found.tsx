// Route-group-level 404 for the authed area. Mirrors the global
// `app/not-found.tsx` exactly — same Arabic copy, same break-mode
// paragraph-write icon. Lives here so `notFound()` calls from
// inside `(app)/project/[id]/page.tsx`, `(app)/preview/[id]/page.tsx`,
// or any other authed route resolve to THIS file (the nearest
// `not-found.tsx` walking up the tree) instead of bouncing past
// the (app) layout. End result: the same break animation that
// plays for unmatched URLs also plays when a revoked user pastes
// a project link they no longer have access to.
//
// Implementation note: we don't render the dashboard shell here.
// The `(app)/layout.tsx` already wraps this file with the
// sidebar + header, so the 404 sits inside the authed chrome —
// the user still feels "logged in", but the deck they tried to
// open is gone with a clear message + recovery affordances.

import Link from "next/link";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

export default function AppNotFound() {
  return (
    <main
      className="dashboard-bg flex min-h-screen flex-col items-center justify-start gap-8 px-6 pt-[22vh] text-center"
      dir="rtl"
    >
      {/* Lift content above the dashboard-bg pseudo-element gradient
          — same `relative z-10` pattern the global not-found uses. */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <ParagraphWriteIcon size={88} className="text-white" mode="break" />
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
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 text-sm font-medium text-white transition-colors hover:border-white/40 hover:bg-white/[0.08]"
        >
          العودة إلى لوحة التحكم
        </Link>
      </div>
    </main>
  );
}
