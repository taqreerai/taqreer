"use client";

// Small client-side hook the project-list grids use to recover from
// the "save → navigate → empty thumbnails" race. After a user saves
// (or first-generates) a deck, the thumbnail-render Inngest job
// runs async — typically ~3–5 s for a 6-slide deck, longer for
// larger ones. If the user navigates to a list page before the job
// finishes, the SSR fetch sees `thumbnailUrls: []` and tiles render
// as placeholders. Before this hook, the user had to manually
// refresh the page to see the real thumbnails once the job
// completed.
//
// What this does:
//   • On mount + whenever the projects array changes, scan for any
//     tile whose `thumbnailUrls` is empty.
//   • If at least one is missing, schedule two `router.refresh()`
//     calls at ~3 s and ~8 s. Both are cheap (re-runs the server
//     component, swaps in fresh data — no full page reload, no
//     scroll loss, no flicker beyond the new tiles fading in).
//   • Give up after the second attempt. If the job is still
//     pending past ~10 s, something's wrong; the user can manually
//     reload.
//
// The hook also cancels its timers on unmount + on every projects-
// array change (so a fresh effect resets the schedule). React's
// strict-mode double-mount in dev does NOT cause double refreshes
// because the cleanup clears the timers before the second invocation
// reschedules.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const FIRST_RETRY_MS = 3_000;
const SECOND_RETRY_MS = 8_000;

type ThumbnailLike = { thumbnailUrls: readonly string[] };

export function useRefreshWhileThumbnailsPending(
  projects: readonly ThumbnailLike[],
): void {
  const router = useRouter();
  useEffect(() => {
    const anyMissing = projects.some(
      (p) => !p.thumbnailUrls || p.thumbnailUrls.length === 0,
    );
    if (!anyMissing) return;
    const t1 = setTimeout(() => router.refresh(), FIRST_RETRY_MS);
    const t2 = setTimeout(() => router.refresh(), SECOND_RETRY_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [projects, router]);
}
