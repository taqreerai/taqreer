// Streaming fallback for /settings: the max-w-6xl column with the page
// title over the stack of settings-card panels - mirrors settings/page.tsx.
// See components/app/PageSkeletons.tsx for the conventions.

import { SkeletonBar } from "@/components/app/PageSkeletons";

export default function Loading() {
  return (
    <div className="page-container animate-pulse" aria-hidden="true">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <SkeletonBar className="mt-8 mb-6 h-8 w-40 rounded-lg" />
        <div className="flex flex-col gap-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-44 rounded-xl bg-[var(--tq-overlay-soft)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
