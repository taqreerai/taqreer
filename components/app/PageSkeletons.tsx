// Shared building blocks for the per-page loading.tsx skeletons under
// app/[lang]/(app)/. Each (app) page is force-dynamic (auth + per-user
// queries), so navigation used to freeze on the old page for the full server
// render; these fallbacks paint instantly inside the DashboardShell while the
// real page streams in.
//
// Server components, token-only (--tq-overlay-soft), animate-pulse, and
// deliberately aria-hidden: the skeletons are decorative (no locale is
// available in loading.tsx for a translated status text) and the real content
// replaces them moments later. Each page's loading.tsx composes these to
// MATCH ITS OWN layout - never reuse another page's shape.

export function SkeletonBar({ className }: { className: string }) {
  return <div className={`rounded bg-[var(--tq-overlay-soft)] ${className}`} />;
}

// The standard page header: tq-h1 title + tq-subhead line.
export function PageHeaderSkeleton() {
  return (
    <header className="mb-8 space-y-3">
      <SkeletonBar className="h-8 w-48 rounded-lg" />
      <SkeletonBar className="h-4 w-72 max-w-full" />
    </header>
  );
}

// The filters row (search + chips) that sits between the header and the grid
// on the browse pages (/projects, /favorites, /templates, /library).
export function FilterRowSkeleton() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <SkeletonBar className="h-10 w-64 max-w-full rounded-full" />
      <SkeletonBar className="h-10 w-24 rounded-full" />
      <SkeletonBar className="h-10 w-24 rounded-full" />
    </div>
  );
}

// The browse-page thumbnail grid (ProjectsGrid's full-page variant):
// aspect-video tiles with a title + date caption underneath.
export function TileGridSkeleton({
  tiles = 10,
  captions = true,
  gridClassName = "grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
}: {
  tiles?: number;
  captions?: boolean;
  gridClassName?: string;
}) {
  return (
    <div className={`grid ${gridClassName}`}>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-video w-full rounded-[14px] bg-[var(--tq-overlay-soft)]" />
          {captions ? (
            <div className="space-y-1.5 px-0.5">
              <SkeletonBar className="h-3 w-3/4" />
              <SkeletonBar className="h-2.5 w-1/3" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Composition used by the browse pages that mirror /projects exactly.
export function BrowsePageSkeleton() {
  return (
    <div className="page-container animate-pulse" aria-hidden="true">
      <PageHeaderSkeleton />
      <FilterRowSkeleton />
      <TileGridSkeleton />
    </div>
  );
}

// One flow card ghost: surface-card rounded-2xl p-4 min-h-[440px] with the
// CardHeader (icon + title) up top and content/footer bars.
function FlowCardSkeleton({ fluid }: { fluid: boolean }) {
  return (
    <div
      className={`surface-card flex min-h-[440px] flex-col gap-4 rounded-2xl p-4 ${
        fluid ? "min-w-[320px] flex-1" : "w-[360px] shrink-0"
      }`}
    >
      {/* CardHeader: icon + title. */}
      <div className="flex items-center gap-2">
        <SkeletonBar className="h-6 w-6 rounded-md" />
        <SkeletonBar className="h-4 w-24" />
      </div>
      {/* Main content slot (textarea / dropzone / preset list). */}
      <div className="min-h-[180px] flex-1 rounded-xl bg-[var(--tq-overlay-soft)]" />
      {/* Footer controls. */}
      <SkeletonBar className="h-10 w-full rounded-xl" />
    </div>
  );
}

// Composition for the 4 flow pages (/create, /enhance, /mimic, /datasheet):
// the centered header at mt-[6vh] over the wrapped card row - same wrapper
// classes as the real pages. `fluid` mirrors /enhance's flex-1 cards;
// create/datasheet use 3 fixed-width cards, mimic 2.
export function FlowPageSkeleton({
  cards,
  fluid = false,
}: {
  cards: number;
  fluid?: boolean;
}) {
  return (
    <div
      className="mt-[6vh] flex w-full animate-pulse flex-col items-center gap-6 px-4"
      aria-hidden="true"
    >
      <header className="flex flex-col items-center gap-3 text-center">
        <SkeletonBar className="h-8 w-64 max-w-full rounded-lg" />
        <SkeletonBar className="h-4 w-80 max-w-full" />
      </header>
      <div
        className={`flex flex-wrap justify-center gap-4 ${fluid ? "w-full items-stretch" : ""}`}
      >
        {Array.from({ length: cards }, (_, i) => (
          <FlowCardSkeleton key={i} fluid={fluid} />
        ))}
      </div>
    </div>
  );
}
