// Global 404 — Next App Router catches any unmatched route here.
// Lives at `app/not-found.tsx` (NOT inside any route group) so it
// takes over before any nested layout, including the authed
// `(app)/layout.tsx`. That means visitors don't see the dashboard
// chrome around the 404 message; they get the same clean shell that
// the marketing pages get.
//
// Design: borrow the dashboard's dark canvas + the paragraph-write
// animation (the lazy-loading icon for slide thumbnails) as a quiet
// brand cue. The icon's LTR write feels right for the English copy.
//
// CTA: a single inline link inside the message — "tell us how you
// did" routes to the homepage's #contact anchor. No back button or
// home button by design; the message is the experience.

import Link from "next/link";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

export default function NotFound() {
  return (
    <main
      // Match the rest of the app's dark canvas. `dashboard-bg` is
      // defined in globals.css and is the same backdrop the authed
      // shell uses, so the 404 feels like part of the same world
      // rather than a generic Next.js error page. `dir="rtl"` because
      // the message is Arabic; the icon enforces its own LTR
      // direction internally via `.paragraph-write-icon { direction:
      // ltr }` so the parent RTL context can't flip the line writes.
      className="dashboard-bg flex min-h-screen flex-col items-center justify-start gap-8 px-6 pt-[22vh] text-center"
      dir="rtl"
    >
      {/* The `.dashboard-bg` class paints its aurora gradient + film-
          grain via `::before` and `::after` pseudo-elements at z-index
          0. Static children land BELOW those pseudo-elements in the
          stacking context (positioned painted after static), so the
          icon + text were invisible against the gradient. Wrapping
          the content in a `relative z-10` layer lifts it above the
          pseudo-elements — same pattern `DashboardShell` uses for
          the main content area of every authed page. */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <ParagraphWriteIcon size={88} className="text-white" mode="break" />
        {/* Three short Arabic lines — the line breaks match the
            user-provided phrasing rhythm. `whitespace-pre-line`
            renders the JSX-level `\n`s as real line breaks while
            still allowing the inline `<Link>` for "أخبرنا كيف
            وصلت إليها" to flow with the rest of the sentence. */}
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

        {/* Home button — pill chrome matching the rest of the app's
            secondary actions (glass surface, white border on hover)
            without using a heavier `.btn-gradient` since this is a
            recovery path, not a primary CTA. */}
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
