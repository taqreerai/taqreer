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

import { NotFoundContent } from "@/components/i18n/NotFoundContent";

export default function AppNotFound() {
  // Direction is inherited from <html dir> (set by the [lang] layout); strings
  // come from the active-locale dictionary via NotFoundContent.
  return (
    <div className="flex flex-col items-center gap-8 px-6 pt-[12vh] text-center">
      <NotFoundContent recovery="dashboard" />
    </div>
  );
}
