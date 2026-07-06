// Dashboard-specific streaming fallback: mirrors dashboard/page.tsx 1:1 -
// the centered launcher hero (greeting + 4 QuickActions cards, same
// min-h / max-w / grid classes) and the HomeLibrary surface-card (toggle +
// view-all header, 5-column aspect-video tile grid). See
// components/app/PageSkeletons.tsx for the conventions (decorative,
// token-only, per-page shapes).

import { SkeletonBar, TileGridSkeleton } from "@/components/app/PageSkeletons";

export default function DashboardLoading() {
  return (
    <div className="page-container animate-pulse pb-16" aria-hidden="true">
      {/* Centered launcher hero — greeting line + the 4 flow cards. */}
      <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
        <div className="w-full">
          {/* Greeting (h1, text-2xl/3xl ≈ 32-36px tall). */}
          <SkeletonBar className="mx-auto mb-8 h-9 w-72 max-w-full rounded-lg" />
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              // QACard: rounded-2xl p-4 min-h-[96px], icon top, text bottom.
              <div
                key={i}
                className="flex min-h-[96px] flex-col gap-2 rounded-2xl bg-[var(--tq-overlay-soft)] p-4"
              >
                <div className="h-6 w-6 rounded-md bg-[var(--tq-overlay)]" />
                <div className="mt-auto space-y-1.5">
                  <div className="h-3.5 w-20 rounded bg-[var(--tq-overlay)]" />
                  <div className="h-3 w-28 max-w-full rounded bg-[var(--tq-overlay)]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HomeLibrary card — toggle + view-all header over the tile grid. */}
      <div className="surface-card rounded-2xl p-5 sm:p-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          {/* SegmentedToggle (two comfortable-size segments). */}
          <SkeletonBar className="h-10 w-48 rounded-full" />
          {/* View-all link. */}
          <SkeletonBar className="h-4 w-16" />
        </header>
        <TileGridSkeleton />
      </div>
    </div>
  );
}
