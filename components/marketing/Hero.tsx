"use client";

// Landing-page hero: centered title + subhead + CTA pair + scroll-tilted
// dashboard preview. Brand chrome references --tq-violet / .btn-gradient
// / .btn-pill / .text-muted to stay in lock-step with the dashboard.

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { DashboardPreview } from "./DashboardPreview";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: "easeOut" as const },
  },
};

// `projectCount` is the platform-wide total of decks created so far
// (server-fetched + cached in `app/page.tsx` via `unstable_cache`).
// Threaded in as a prop so this client component stays
// presentational — no client-side DB round-trip on a public page.
// Undefined / 0 falls back to a hidden chip so we never render
// "تم إنشاء 0 عرض تقديمي حتى الآن" on a fresh DB.
export function Hero({ projectCount }: { projectCount?: number }) {
  const dict = useDict();
  const { locale } = useLocale();

  // Tracks the demo dashboard's active view as a path string so the
  // browser-chrome URL pill stays in sync with whichever flow the
  // visitor clicked into (DashboardPreview emits the path, Hero
  // mirrors it here, BrowserChromeBar reads it). 2026-05-28.
  const [demoPath, setDemoPath] = useState("/dashboard");

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
      <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          // `.hero-fold-copy` reserves the first viewport for the copy
          // (centered) so the preview's top edge always lands ~180px
          // above the fold - identical composition on laptop and 4K
          // (see globals.css "Hero fold composition").
          className="hero-fold-copy flex flex-col items-center justify-center"
        >
          {/* Status chip pair. The violet count chip only renders when
              we have a real positive count from the DB — keeps the
              "0 عرض تقديمي" edge case off the marketing surface. */}
          <motion.div
            variants={itemVariants}
            className="mb-8 flex w-full flex-wrap justify-center gap-3"
          >
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
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="mb-8 w-full text-4xl font-medium leading-tight md:text-6xl"
          >
            {dict.landing.hero.titleLine1} <br />
            <span className="text-gradient">{dict.landing.hero.titleLine2}</span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mx-auto mb-12 w-full max-w-xl text-lg leading-relaxed text-muted md:text-xl"
          >
            {dict.landing.hero.subtitle}
          </motion.p>

          <div className="mb-20 flex w-full justify-center">
            {/* Single primary CTA. Uses `.btn-gradient-anim` (the
                canonical AI-button — animated gradient stroke with
                a hover gradient fill, see globals.css PATTERN 4)
                per user direction 2026-05-28: the landing's entry
                point gets the same visual weight as the in-app
                Generate button. Pill radius pinned inline since
                `.btn-gradient-anim` itself doesn't set one. */}
            <motion.a
              href={localizedHref("/signup", locale)}
              variants={itemVariants}
              className="btn-gradient-anim rounded-full px-8 py-3 text-sm font-medium"
            >
              {dict.landing.hero.cta}
            </motion.a>
          </div>
        </motion.div>

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

            {/* Browser-chrome frame (traffic dots + URL pill showing
                https://taqreer.ai/dashboard) wrapped around an
                interactive HTML demo (<DashboardPreview/>) that
                replaced the static /hero.png screenshot 2026-05-28.
                The four QuickActions cards inside the demo are
                clickable — each one swaps the panel to a static
                rendering of the corresponding flow (/create,
                /enhance, /mimic, /datasheet). Files cannot actually
                be uploaded — dropzones are visual chrome only.

                The chrome bar + preview pane stack inside one outer
                `rounded-2xl` border — a complete browser window with
                crisp edges (no bottom-fade mask). */}
            <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)]">
              {/* Browser chrome — Mac Safari recipe: colored traffic
                  lights, paired ‹ › nav arrows, shield, URL pill with
                  lock + domain + refresh, and a right-side action
                  cluster (download / share / + / all-tabs). Forced
                  `dir="ltr"` so the URL + chrome read left-to-right
                  inside an RTL page; traffic lights stay anchored to
                  the visual left as users expect from real browsers.
                  All surfaces (nav buttons, URL pill, right cluster)
                  use the design-system tokens (`--tq-surface`,
                  `--tq-border-hairline`, `--tq-text-muted`) so the bar
                  inherits the same glass language as the rest of the
                  app — no hardcoded surface colors. */}
              <BrowserChromeBar path={demoPath} />

              {/* Interactive dashboard preview — aspect-[3/2] preserves
                  the same outer ratio the static hero.png used (1440 ×
                  960). The DashboardPreview's content scales within
                  this box; its absolutely-positioned inner pane fills
                  the aspect container so the chrome bar above stays
                  in proportion. Below `sm` the quick-action grid stacks
                  2×2 (vs 1×4) + the dashboard reads portrait, so the box
                  goes taller (4:5) to fit the content without clipping;
                  at `sm`+ it returns to the 3:2 landscape ratio. */}
              <div className="relative aspect-[4/5] w-full sm:aspect-[3/2]">
                <DashboardPreview onPathChange={setDemoPath} />
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

      {/* Address bar only — centered, no icons inside (just the URL). */}
      <div className="absolute left-1/2 w-full max-w-[300px] -translate-x-1/2 px-4">
        <div className="truncate rounded-md border border-[var(--tq-border-hairline)] bg-black/25 px-3 py-1 text-center font-mono text-[11px] text-[var(--tq-text-muted)]">
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
