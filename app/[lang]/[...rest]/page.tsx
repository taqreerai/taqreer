import { notFound } from "next/navigation";

// Catch-all for unmatched paths under a locale (e.g. /en/banana). Throws into the
// not-found boundary (app/[lang]/not-found.tsx) so the response carries a real
// HTTP 404 — Next only renders a custom not-found for an explicit notFound(), and
// with the root layout under [lang] there's no true-root app/not-found.tsx to
// catch unmatched URLs globally.
//
// Heads-up: in `next dev` this can surface a dev-ONLY React profiler warning
// ("Failed to execute 'measure' on 'Performance' … negative time stamp") — a
// tracked Next 16 bug for [lang] catch-alls (vercel/next.js#86060). It never runs
// in production and doesn't affect the rendered 404.
export default function CatchAllNotFound() {
  notFound();
}
