"use client";

// Embeds the FULL hero dashboard demo (DashboardPreview: icon rail + top
// bar + flow body) on a marketing spoke page, framed in the same browser-
// window chrome - but PINNED to that page's flow via `lockedView`: the
// flow's sidebar dot reads active and every navigation is a no-op, so a
// visitor sees the real app around the flow without wandering off the
// page's subject (user direction 2026-08-08; previously this rendered
// the bare flow cards with no dashboard chrome).
// Reused by the flow spokes (/ai-presentations = create, /social-media-posts
// = social, /redesign = enhance, /presentation-style = mimic). Copy tracks
// dict.flows.* via getFlows inside the demo, so it can't drift from the
// live flows.

import { DashboardPreview } from "@/components/marketing/DashboardPreview";

export function FlowPreview({
  view,
}: {
  view: "create" | "enhance" | "mimic" | "social";
}) {
  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)] bg-[var(--tq-panel)]">
      {/* Browser-chrome bar - mirrors the hero demo window (macOS traffic
          lights + a centered URL pill showing the real in-app flow route). */}
      <div
        dir="ltr"
        className="relative flex h-10 items-center border-b border-[var(--tq-border-hairline)] bg-[var(--tq-card)] px-4"
      >
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: "#FF5F57" }} />
          <span className="h-3 w-3 rounded-full" style={{ background: "#FEBC2E" }} />
          <span className="h-3 w-3 rounded-full" style={{ background: "#28C840" }} />
        </div>
        <div className="absolute left-1/2 w-full max-w-[280px] -translate-x-1/2 px-4">
          {/* Address pill on --tq-surface (white in light, raised glass in
              dark) - the recessed black/25 fill read as a dark blob on the
              light theme (user direction 2026-08-08). */}
          <div className="truncate rounded-md border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-3 py-1 text-center font-mono text-[11px] text-[var(--tq-text-muted)]">
            taqreer.ai/{view}
          </div>
        </div>
      </div>

      {/* The full dashboard demo, pinned to this page's flow. Same aspect
          recipe as the hero: portrait below `sm` (the cards stack), 3:2 at
          `sm`+; DashboardPreview's inner pane is absolutely positioned and
          fills the box. */}
      <div className="relative aspect-[4/5] w-full sm:aspect-[3/2]">
        <DashboardPreview lockedView={view} />
      </div>
    </div>
  );
}
