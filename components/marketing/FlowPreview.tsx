"use client";

// Inlines the EXACT static flow cards from the hero demo (DashboardPreview's
// getFlows + FlowCard) on a marketing spoke page, framed in the same browser-
// window chrome so a visitor sees the real, deeply-customizable flow form.
// Static: the Generate button is disabled and no real inputs are mounted.
// Reused by the flow spokes (/ai-presentations = create, /social-media-posts =
// social, /redesign = enhance). Copy tracks dict.flows.* via getFlows, so it
// can't drift from the live flows.

import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { getFlows, FlowCard } from "@/components/marketing/DashboardPreview";

export function FlowPreview({
  view,
}: {
  view: "create" | "enhance" | "mimic" | "social";
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const flow = getFlows(dict, dir)[view];

  return (
    <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)] bg-[var(--tq-panel)]">
      {/* Browser-chrome bar — mirrors the hero demo window (macOS traffic
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
          <div className="truncate rounded-md border border-[var(--tq-border-hairline)] bg-black/25 px-3 py-1 text-center font-mono text-[11px] text-[var(--tq-text-muted)]">
            taqreer.ai/{view}
          </div>
        </div>
      </div>

      {/* Flow body — the real flow's card layout (content / brand identity /
          output), rendered statically. */}
      <div className="px-4 py-8" dir={dir}>
        <div className="flex flex-wrap items-stretch justify-center gap-3">
          {flow.cards.map((card, i) => (
            <FlowCard key={i} card={card} />
          ))}
        </div>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled
            aria-disabled
            className="btn-gradient-anim rounded-full px-6 py-2.5 text-sm font-medium opacity-90"
          >
            {flow.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
