// Streaming fallback for the (app) pages. These routes are force-dynamic
// (auth round trip + per-user queries), so without this the click on
// "لوحة التحكم" froze on the old page for the full server render (~1s+
// measured on prod). With it, the shell paints immediately and the content
// area shows this skeleton while the page streams in.
//
// Pure visual, token-only (no dictionary: a skeleton has no copy). Mirrors
// the dashboard's REAL structure 1:1 so the swap is seamless:
//   - the centered launcher hero (greeting line + 4 QuickActions cards,
//     same min-h / max-w / grid classes as dashboard/page.tsx),
//   - the HomeLibrary surface-card (toggle + view-all header, then the
//     5-column aspect-video tile grid with caption lines, same classes as
//     HomeLibrary.tsx / ProjectsGrid).

const LIBRARY_TILES = 10;

export default function AppLoading() {
  return (
    // Purely decorative placeholder (no locale here for a text alternative,
    // and the real content streams in moments later): hidden from assistive
    // tech entirely rather than announcing an untranslated busy state.
    <div className="page-container animate-pulse pb-16" aria-hidden="true">
      {/* Centered launcher hero — greeting line + the 4 flow cards. */}
      <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
        <div className="w-full">
          {/* Greeting (h1, text-2xl/3xl ≈ 32-36px tall). */}
          <div className="mx-auto mb-8 h-9 w-72 max-w-full rounded-lg bg-[var(--tq-overlay-soft)]" />
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
          <div className="h-10 w-48 rounded-full bg-[var(--tq-overlay-soft)]" />
          {/* "عرض الكل" link. */}
          <div className="h-4 w-16 rounded bg-[var(--tq-overlay-soft)]" />
        </header>
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: LIBRARY_TILES }, (_, i) => (
            // ProjectThumbnail card: aspect-video tile + title/date caption.
            <div key={i} className="flex flex-col gap-3">
              <div className="aspect-video w-full rounded-[14px] bg-[var(--tq-overlay-soft)]" />
              <div className="space-y-1.5 px-0.5">
                <div className="h-3 w-3/4 rounded bg-[var(--tq-overlay-soft)]" />
                <div className="h-2.5 w-1/3 rounded bg-[var(--tq-overlay-soft)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
