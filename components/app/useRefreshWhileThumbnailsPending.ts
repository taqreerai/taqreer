"use client";

// Small client-side hook the project-list grids use to recover from
// two transient states that both render as a loading spinner on the
// tile:
//   1. Post-save thumbnail-render: deck is saved, Inngest PNG job
//      in flight. Typically resolves in 3–5 s for a 6-slide deck.
//   2. Initial deck-generate: project just kicked off, Anthropic
//      stream + Inngest function still running. Wall-clock varies
//      from ~10 s (fast preset) to 1–3 min (extreme preset, heavy
//      content).
//
// The hook fires `router.refresh()` at a fixed schedule so the SSR
// query re-runs and the spinner swaps to rendered thumbnails when
// the underlying state lands.
//
// Bounded retry semantics (caught by CR 2026-05-21):
// Each fresh "pending" detection schedules a fixed set of refreshes.
// After all have fired, the hook stops scheduling — re-renders that
// still see pending tiles (because the job is genuinely slow or has
// failed) do NOT re-arm the timers. Without the ref-based attempt
// counter, every server-refresh-that-still-shows-pending would
// re-schedule the timers, producing an unbounded poll-every-3 s loop.
//
// Schedule: 3 s / 8 s catch the fast-finish thumbnail render. The
// longer tail (20 s / 45 s / 90 s / 150 s) covers initial deck-
// generate runs that take longer than the first 8 s — without it
// the spinner sat forever for any extreme-preset generation when
// the user navigated to a list page mid-run (reported 2026-05-24).
// Cap at ~2.5 min total polling window per fresh-pending detection;
// runs that haven't finished by then are presumed stuck and the
// user reloads manually.
//
// The attempt counter resets to zero when the "no tiles pending"
// state is observed, so a later save can re-trigger a fresh cycle
// without a remount.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const RETRY_SCHEDULE_MS = [3_000, 8_000, 20_000, 45_000, 90_000, 150_000];

type ThumbnailLike = { thumbnailsPending: boolean };

export function useRefreshWhileThumbnailsPending(
  projects: readonly ThumbnailLike[],
): void {
  const router = useRouter();
  // Holds the live timer handles for the CURRENT pending window so
  // we can clear them on the "all done" transition and on unmount.
  // `scheduledRef` gates re-scheduling: each timer in `RETRY_SCHEDULE_MS`
  // is enqueued ONCE per fresh pending window — re-renders triggered
  // by our own `router.refresh()` don't re-fire the schedule. Without
  // this gate, every refresh would cancel the unfired timers and
  // re-create them with delays relative to "now", drifting the
  // long-tail intervals further out each time (e.g. a 150 s timer
  // could end up firing 5+ minutes after a 90 s generation finished).
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scheduledRef = useRef(false);
  useEffect(() => {
    const anyPending = projects.some((p) => p.thumbnailsPending);
    if (!anyPending) {
      // Successful state — clear any unfired timers, reset the
      // gate so a future pending window starts fresh.
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      scheduledRef.current = false;
      return;
    }
    // Pending detected. If we've already scheduled this window's
    // timer cohort, do nothing — the original timers are still
    // ticking on their original deadlines.
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    timersRef.current = RETRY_SCHEDULE_MS.map((delayMs) =>
      setTimeout(() => {
        router.refresh();
      }, delayMs),
    );
  }, [projects, router]);

  // True unmount cleanup — separate from the pending-tracking
  // effect above so it ONLY fires when the component goes away,
  // not on every `projects` change. Prevents leaked timers when
  // the user navigates away mid-poll.
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    };
  }, []);

  // Background-tab safety net. Browsers throttle `setTimeout` in
  // hidden tabs (Chrome / Safari clamp to once-per-second or worse),
  // so the polling schedule above can slip well behind real time
  // when the user has the dashboard open in a background tab. By
  // the time they switch back, the generation may have finished
  // long ago AND the timer cohort may have either already-fired
  // (without picking up the new state due to RSC cache) or be sitting
  // far in the future. Either way, the spinner stays stuck.
  //
  // Fix: refresh immediately on every `visibilitychange → visible`
  // transition that still has at least one pending tile. The pending
  // check uses a ref so the listener doesn't need to rebind on every
  // `projects` change (rebinding every render would churn through
  // event-listener registrations on a tab that's rendering once a
  // second under React's render-on-state-change rhythm).
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      const anyPending = projectsRef.current.some((p) => p.thumbnailsPending);
      if (anyPending) router.refresh();
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
    };
  }, [router]);
}
