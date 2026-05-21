"use client";

// Small client-side hook the project-list grids use to recover from
// the "save → navigate → empty thumbnails" race. After a user saves
// (or first-generates) a deck, the thumbnail-render Inngest job
// runs async — typically ~3–5 s for a 6-slide deck, longer for
// larger ones. If the user navigates to a list page before the job
// finishes, the SSR fetch sees `thumbnailUrls: []` and tiles render
// as the loading spinner. This hook fires `router.refresh()` at
// fixed offsets so the new thumbnails swap in without a manual
// page reload.
//
// Bounded retry semantics (caught by CR 2026-05-21):
// Each fresh "pending" detection schedules AT MOST two refreshes
// total (~3 s and ~8 s after the FIRST pending render). After both
// have fired, the hook stops scheduling — re-renders that happen
// to still have pending tiles (because the job is genuinely slow
// or has failed) do NOT re-arm the timers. Without the ref-based
// attempt counter, every server-refresh-that-still-shows-pending
// would re-schedule both timers, producing an unbounded
// poll-every-3s loop.
//
// The attempt counter resets to zero when the "no tiles pending"
// state is observed, so a later save can re-trigger a fresh
// two-attempt cycle without a remount.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FIRST_RETRY_MS = 3_000;
const SECOND_RETRY_MS = 8_000;
const MAX_ATTEMPTS = 2;

type ThumbnailLike = { thumbnailsPending: boolean };

export function useRefreshWhileThumbnailsPending(
  projects: readonly ThumbnailLike[],
): void {
  const router = useRouter();
  // Tracks how many refresh attempts have already been scheduled
  // for the CURRENT pending window. Survives re-renders. Resets
  // to zero whenever no projects are pending (a successful refresh
  // → clears the count → a future save can re-trigger).
  const attemptsRef = useRef(0);
  useEffect(() => {
    const anyPending = projects.some((p) => p.thumbnailsPending);
    if (!anyPending) {
      // Successful state — reset the counter so a future pending
      // window starts fresh.
      attemptsRef.current = 0;
      return;
    }
    // Pending detected. If we've already used both attempts during
    // THIS window, stop — the job is genuinely slow or has failed,
    // continuing to poll would be wasted bandwidth + a memory
    // leak via accumulating timers.
    if (attemptsRef.current >= MAX_ATTEMPTS) return;
    // Schedule only the still-pending attempts. attempt #0 → t1,
    // attempt #1 → t2. After both fire and the next render still
    // sees pending tiles, attemptsRef === 2 → no more scheduling.
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (attemptsRef.current === 0) {
      timers.push(
        setTimeout(() => {
          attemptsRef.current += 1;
          router.refresh();
        }, FIRST_RETRY_MS),
      );
    }
    if (attemptsRef.current <= 1) {
      timers.push(
        setTimeout(() => {
          attemptsRef.current += 1;
          router.refresh();
        }, SECOND_RETRY_MS),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [projects, router]);
}
