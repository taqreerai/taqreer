// Route-group-level 404 for the authed area. `(app)/layout.tsx`
// already wraps this file with the sidebar + header + `dashboard-bg`
// background, so the 404 sits INSIDE the authed chrome — the user
// still feels "logged in", the sidebar stays visible, but the deck
// they tried to open is gone with a clear message + recovery affordance.
//
// Resolution: Next walks UP from any unmatched URL looking for the
// nearest `not-found.tsx`. Anything under the `(app)` group —
// `/dashboard/*`, `/projects/*`, `/favorites/*`, `/settings/*`,
// `/templates/*`, `/brand-kits/*`, `/project/*`, `/preview/*` — and
// any in-page `notFound()` calls from those routes resolve HERE,
// inside the dashboard chrome. URLs entirely outside the group
// (like `/banana`) bubble up to the global `app/not-found.tsx`,
// which paints its own full-bleed dashboard-bg canvas.
//
// Layout note: we DON'T add `<main>`, `min-h-screen`, `dashboard-bg`,
// or `relative z-10` here — the parent shell already provides all
// of those. Doubling up on `min-h-screen` was the source of the
// stray scrollbar (100vh wrapper inside an already-100vh shell with
// a `pt-28` content area would always overflow the viewport).

import Link from "next/link";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";

export default function AppNotFound() {
  return (
    <div
      className="flex flex-col items-center gap-8 px-6 pt-[12vh] text-center"
      dir="rtl"
    >
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
  );
}
