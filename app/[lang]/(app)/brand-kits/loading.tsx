// Streaming fallback for /brand-kits: header row (title/subtitle + the
// "new kit" button) over the kit-tile grid (grid-cols-1 sm:2 lg:3 xl:4,
// rounded-3xl tiles) - mirrors BrandKitsPageClient. See
// components/app/PageSkeletons.tsx for the conventions.

import { SkeletonBar } from "@/components/app/PageSkeletons";

export default function Loading() {
  return (
    <div className="page-container animate-pulse" aria-hidden="true">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-3">
          <SkeletonBar className="h-8 w-48 rounded-lg" />
          <SkeletonBar className="h-4 w-72 max-w-full" />
        </div>
        <SkeletonBar className="h-10 w-32 shrink-0 rounded-full" />
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-44 rounded-3xl bg-[var(--tq-overlay-soft)]"
          />
        ))}
      </div>
    </div>
  );
}
