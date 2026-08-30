"use client";

// Landing-page hero: centered title + subhead + CTA pair + scroll-tilted
// product demo over the LIVING TEMPLATE WALL (the same rotated marquee
// the auth pages paint - user direction 2026-08-10). Brand chrome
// references --tq-violet / .btn-gradient / .btn-pill / .text-muted to
// stay in lock-step with the dashboard.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import dynamic from "next/dynamic";
import { AuthMarqueeBackground } from "@/components/auth/AuthMarqueeBackground";
import type { MarqueeColumns } from "@/lib/auth/marquee-projects";

// The create-flow showcase is a large decorative demo, not SEO content.
// Load it client-only so it stays out of the landing's SSR — that keeps
// the server render down to the lightweight text sections. The sized
// `.hero-preview-frame` holds the space, so there's no layout shift.
// (Replaced the interactive DashboardPreview 2026-08-10 - the cinematic
// create mini-tutorial from the feature-showcase lab.)
const CreateScene = dynamic(
  () =>
    import("@/components/marketing/showcase/scenes/CreateScene").then(
      (m) => m.CreateScene,
    ),
  { ssr: false },
);

// `projectCount` is the platform-wide total of decks created so far
// (server-fetched + cached in `app/page.tsx` via `unstable_cache`).
// Threaded in as a prop so this client component stays
// presentational — no client-side DB round-trip on a public page.
// Undefined / 0 falls back to a hidden chip so we never render
// "تم إنشاء 0 عرض تقديمي حتى الآن" on a fresh DB.
// Lint-safe media-query read (same recipe as ScrollReveal): SSR assumes
// motion-ok, the client corrects on commit - the scene then renders its
// settled final frame instead of animating.
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

export function Hero({
  projectCount,
  marqueeColumns,
}: {
  projectCount?: number;
  // Curated-template thumbnails for the living wall behind the hero
  // (server-fetched in app/[lang]/page.tsx, same loader as the auth
  // pages). Optional: an empty/missing set simply renders no wall.
  marqueeColumns?: MarqueeColumns;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const reducedMotion = usePrefersReducedMotion();

  // Scroll-driven rotation: full 15° tilt at the top of the page,
  // flattening to 0° as the visitor scrolls. The flatten distance is
  // measured from layout - "how far must the page scroll before the
  // preview's bottom edge meets the viewport bottom" (the original
  // end condition, user direction 2026-05-28) - but CLAMPED to a
  // minimum. The previous element-reveal mapping (`useScroll` target
  // + offset ["start end","end end"]) degenerated on tall viewports:
  // when the whole preview already fit in the first screen, progress
  // started at 1 and the tilt never existed (user-spotted 2026-06-11).
  // Pixel-based progress with a 360px floor keeps small screens
  // behaving as before and gives tall screens a resting tilt that
  // settles over the first few hundred pixels of scroll.
  //
  // Measured via the offsetParent chain (layout position) rather than
  // getBoundingClientRect so the entrance animation's transforms and
  // the tilt itself can't skew the measurement.
  const dashboardWrapperRef = useRef<HTMLDivElement>(null);
  const MIN_FLATTEN_PX = 360;
  const [flattenDistance, setFlattenDistance] = useState(MIN_FLATTEN_PX);
  useEffect(() => {
    const measure = () => {
      const el = dashboardWrapperRef.current;
      if (!el) return;
      let top = 0;
      let node: HTMLElement | null = el;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      const untilBottomMeetsViewport = top + el.offsetHeight - window.innerHeight;
      setFlattenDistance(Math.max(MIN_FLATTEN_PX, untilBottomMeetsViewport));
    };
    measure();
    // Layout can shift once fonts/images settle - re-measure next frame
    // and on resize.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const { scrollY } = useScroll();
  const rotateX = useTransform(scrollY, [0, flattenDistance], [15, 0], {
    clamp: true,
  });

  // Latin numerals + thousand separator ("12,345") — RTL-safe inside
  // the Arabic chip copy, per the project's "Latin digits only" rule.
  // Baseline added to the live DB total for the public "decks created" counter.
  const COUNT_BASELINE = 20000;
  const formattedCount =
    typeof projectCount === "number" && projectCount > 0
      ? new Intl.NumberFormat("en-US").format(projectCount + COUNT_BASELINE)
      : null;

  return (
    <section className="glow-effect relative overflow-hidden pt-40 pb-32">
      {/* Living template wall - the login marquee embedded as the hero
          backdrop (absolute, scoped to this section). Its built-in
          center fade is tuned for the auth glass modal; the hero copy
          sits bare on the wall, so a top-anchored scrim (below) adds
          the missing separation. */}
      {marqueeColumns && (
        <>
          {/* The wall is MASKED, not overpainted: fully visible behind
              the first-viewport copy, it starts dissolving above the
              animation window (top edge ~180px above the fold - see
              globals.css "Hero fold composition") and is fully gone just
              past the window's TOP - tiles peek faintly over the frame's
              upper edge, nothing behind its center (user direction
              2026-08-30). True mask = the page background shows through,
              no solid band over the glow. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              // Wide EASED feather (same multi-stop trick as the aura /
              // marquee masks - a 2-stop linear reads as a hard band):
              // ~820px ramp starting mid-copy, fully gone just past the
              // window's top edge.
              WebkitMaskImage:
                "linear-gradient(to bottom, black 0%, black calc(100vh - 700px), rgba(0,0,0,0.78) calc(100vh - 480px), rgba(0,0,0,0.5) calc(100vh - 290px), rgba(0,0,0,0.22) calc(100vh - 100px), transparent calc(100vh + 120px))",
              maskImage:
                "linear-gradient(to bottom, black 0%, black calc(100vh - 700px), rgba(0,0,0,0.78) calc(100vh - 480px), rgba(0,0,0,0.5) calc(100vh - 290px), rgba(0,0,0,0.22) calc(100vh - 100px), transparent calc(100vh + 120px))",
            }}
          >
            <AuthMarqueeBackground columns={marqueeColumns} fixed={false} />
          </div>
          {/* Copy scrim - strongest behind the first-viewport headline,
              feathering out so the tiles stay crisp around the demo. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[85vh]"
            style={{
              background:
                "linear-gradient(to bottom, color-mix(in srgb, var(--tq-bg) 85%, transparent) 0%, color-mix(in srgb, var(--tq-bg) 55%, transparent) 55%, transparent 100%)",
            }}
          />
        </>
      )}

      <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        {/* CSS-driven entrance (`.hero-enter`, per-element stagger via
            animationDelay) instead of Framer Motion: the copy must paint
            on first load, not after hydration, or the subtitle becomes a
            ~3s-delayed LCP element (see globals.css "Hero copy entrance").
            `.hero-fold-copy` reserves the first viewport for the copy
            (centered) so the preview's top edge always lands ~180px above
            the fold - identical composition on laptop and 4K. */}
        <div className="hero-fold-copy flex flex-col items-center justify-center">
          {/* Status chip pair. The violet count chip only renders when
              we have a real positive count from the DB — keeps the
              "0 عرض تقديمي" edge case off the marketing surface. */}
          <div className="hero-enter mb-8 flex w-full flex-wrap justify-center gap-3">
            {formattedCount && (
              <span className="hero-stat-pill flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "#fff" }}
                />
                {dict.landing.hero.statusCount.replace("{count}", String(formattedCount))}
              </span>
            )}
            <span className="whitespace-nowrap rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-4 py-1.5 text-xs font-medium text-muted">
              {dict.landing.hero.poweredBy}
            </span>
          </div>

          <h1
            className="hero-enter mb-8 w-full text-4xl font-medium leading-tight md:text-6xl"
            style={{ animationDelay: "0.15s" }}
          >
            {dict.landing.hero.titleLine1} <br />
            <span className="text-gradient">{dict.landing.hero.titleLine2}</span>
          </h1>

          <p
            className="hero-enter mx-auto mb-12 w-full max-w-xl text-lg leading-relaxed text-muted md:text-xl"
            style={{ animationDelay: "0.3s" }}
          >
            {dict.landing.hero.subtitle}
          </p>

          <div className="mb-20 flex w-full justify-center">
            {/* Single primary CTA. Uses `.btn-gradient-anim` (the
                canonical AI-button — animated gradient stroke with
                a hover gradient fill, see globals.css PATTERN 4)
                per user direction 2026-05-28: the landing's entry
                point gets the same visual weight as the in-app
                Generate button. Pill radius pinned inline since
                `.btn-gradient-anim` itself doesn't set one. */}
            <a
              href={localizedHref("/signup", locale)}
              className="hero-enter btn-gradient-anim rounded-full px-8 py-3 text-sm font-medium"
              style={{ animationDelay: "0.45s" }}
            >
              {dict.landing.hero.cta}
            </a>
          </div>
        </div>

      </div>

      {/* Tilted dashboard preview. All back glow layers were removed (the
          §24 stacked light-bar halo + the older blur layer) - the preview
          sits flat over the page background.

          Lives OUTSIDE the max-w-7xl copy container in its own
          `.hero-preview-frame`: 64rem floor (the old max-w-5xl - laptops
          unchanged) growing with viewport height on tall screens so the
          peek-then-reveal composition stays constant up to 4K (see
          globals.css "Hero fold composition"). */}
      <div className="relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="hero-preview-frame relative mx-auto"
          style={{ perspective: "1000px" }}
        >
          <motion.div
            // Entrance: image starts low + pulled toward the camera
            // (translateZ positive), then rises up + recedes back
            // into Z space to land at its resting pose. The
            // `perspective: 1000px` on the parent +
            // `transformStyle: preserve-3d` make translateZ render
            // as genuine depth (not just scale). rotateX is
            // INTENTIONALLY omitted from initial/animate so it stays
            // bound to the scroll-driven motion value throughout —
            // otherwise framer-motion would tween rotateX during the
            // entrance and then hand control back to `style.rotateX`,
            // causing the visible jump on first scroll the user
            // flagged.
            initial={{ opacity: 0, y: 180, z: 350 }}
            animate={{ opacity: 1, y: 0, z: 0 }}
            transition={{
              duration: 1.3,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.5,
            }}
            ref={dashboardWrapperRef}
            style={{ rotateX, transformStyle: "preserve-3d" }}
            // `origin-center` (vs the previous `origin-top`) so the
            // scroll-tilt pivots around the dashboard's vertical
            // middle, not its top edge. With top-anchored origin the
            // bottom swung away dramatically while the title stayed
            // fixed; centered origin makes the tilt symmetrical
            // (top recedes, bottom advances by equal amounts) so the
            // whole preview reads as one rigid panel leaning toward
            // the viewer. User direction 2026-05-28.
            className="relative origin-center"
          >

            {/* Browser-chrome frame (traffic dots + URL pill pinned to
                taqreer.ai/create) wrapped around the cinematic create
                mini-tutorial (<CreateScene/>) - replaced the interactive
                DashboardPreview 2026-08-10. The scene loops on its own
                (typing -> brand -> settings -> generate -> deck wall);
                nothing inside is clickable.

                The chrome bar + preview pane stack inside one outer
                `rounded-2xl` border — a complete browser window with
                crisp edges (no bottom-fade mask). */}
            <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)]">
              <BrowserChromeBar path="/create" />

              {/* The scene is authored for a 16:9 stage (its card rail,
                  cursor waypoints and deck wall all assume it), so the
                  box is aspect-video at every breakpoint. Solid --tq-bg
                  underneath: the scene's aura layer has no base fill of
                  its own and the marquee wall must not read through. */}
              <div className="relative aspect-video w-full bg-[var(--tq-bg)]">
                <CreateScene reduced={reducedMotion} />
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Browser chrome bar ─────────────────────────────────────────
// Mac Safari recipe (replicated from the user-supplied reference
// screenshot 2026-05-28). All chrome surfaces use the design-system
// tokens (`--tq-surface`, `--tq-border-hairline`, `--tq-text-muted`)
// so the bar inherits the same glass language as the dashboard
// header below it — no hardcoded surface colors.
//
// Matches the BiDi canvas window header: a --tq-card bar with macOS traffic
// lights + the two ghost glyphs on the right. Simplified to the address bar
// only — no nav arrows / right action cluster, and no icons inside the address
// bar (just the URL). Traffic-light colors are universal OS chrome.

function BrowserChromeBar({ path }: { path: string }) {
  return (
    <div
      dir="ltr"
      className="relative flex h-11 items-center border-b border-[var(--tq-border-hairline)] bg-[var(--tq-card)] px-4"
    >
      {/* macOS traffic lights — same as the BiDi canvas window header. */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
      </div>

      {/* Address bar only - centered, no icons inside (just the URL).
          Pill sits on --tq-surface (white in light, raised glass in dark);
          the recessed black/25 fill read as a dark blob on the light theme
          (user direction 2026-08-08). */}
      <div className="absolute left-1/2 w-full max-w-[300px] -translate-x-1/2 px-4">
        <div className="truncate rounded-md border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-3 py-1 text-center font-mono text-[11px] text-[var(--tq-text-muted)]">
          taqreer.ai{path}
        </div>
      </div>

      {/* Right ghost glyphs — same two as the BiDi canvas header. */}
      <div className="ms-auto flex items-center gap-3 text-foreground/25">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h16M4 6h16M4 18h16" />
        </svg>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
    </div>
  );
}
