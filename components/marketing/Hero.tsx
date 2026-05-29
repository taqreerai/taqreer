"use client";

// Landing-page hero: centered title + subhead + CTA pair + scroll-tilted
// dashboard preview. Brand chrome references --tq-violet / .btn-gradient
// / .btn-pill / .text-muted to stay in lock-step with the dashboard.

import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
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
  // Tracks the demo dashboard's active view as a path string so the
  // browser-chrome URL pill stays in sync with whichever flow the
  // visitor clicked into (DashboardPreview emits the path, Hero
  // mirrors it here, BrowserChromeBar reads it). 2026-05-28.
  const [demoPath, setDemoPath] = useState("/dashboard");

  // Scroll-driven rotation that hits 0° exactly when the dashboard
  // container's bottom edge reaches the bottom of the viewport
  // (user direction 2026-05-28: was tied to a fixed scrollY of 600
  // and felt delayed — the moment the bottom edge lands at the
  // viewport edge, the rotation should be flat). `useScroll` with
  // a `target` + `offset` ties the progress to the element's actual
  // position instead of an arbitrary px value: progress 0 when the
  // element's top crosses the viewport bottom (just entering view),
  // progress 1 when the element's bottom crosses the viewport bottom
  // (fully revealed). Maps 0 → 1 onto rotateX 15° → 0°.
  const dashboardWrapperRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: dashboardWrapperRef,
    offset: ["start end", "end end"],
  });
  const rotateX = useTransform(scrollYProgress, [0, 1], [15, 0]);

  // Latin numerals + thousand separator ("12,345") — RTL-safe inside
  // the Arabic chip copy, per the project's "Latin digits only" rule.
  const formattedCount =
    typeof projectCount === "number" && projectCount > 0
      ? new Intl.NumberFormat("en-US").format(projectCount)
      : null;

  return (
    <section className="glow-effect relative overflow-hidden pt-40 pb-32">
      <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center"
        >
          {/* Status chip pair. The violet count chip only renders when
              we have a real positive count from the DB — keeps the
              "0 عرض تقديمي" edge case off the marketing surface. */}
          <motion.div
            variants={itemVariants}
            className="mb-8 flex w-full justify-center gap-3"
          >
            {formattedCount && (
              <span className="hero-stat-pill flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--tq-violet)" }}
                />
                تم إنشاء {formattedCount} عرض تقديمي حتى الآن
              </span>
            )}
            <span className="rounded-full border border-[var(--tq-border-glass)] bg-[var(--tq-bg-glass)] px-4 py-1.5 text-xs font-medium text-muted">
              مدعوم بتقنية Claude Design
            </span>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="mb-8 w-full text-4xl font-medium leading-tight md:text-6xl"
          >
            حوّل محتواك إلى عرض <br />
            <span className="text-gradient">احترافي خلال دقائق</span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mx-auto mb-12 w-full max-w-2xl text-lg leading-relaxed text-muted md:text-xl"
          >
            taqreer.ai يحوّل محتواك إلى عروض تقديمية مصممة بالكامل، يدعم العربية
            والإنجليزية. يحافظ على هويتك البصرية، ويمنحك محررًا متقدمًا لتعديل
            كل شريحة مباشرة داخل المتصفح.
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
              href="/signup"
              variants={itemVariants}
              className="btn-gradient-anim rounded-full px-8 py-3 text-sm font-medium"
            >
              ابدأ الآن مجاناً
            </motion.a>
          </div>
        </motion.div>

        {/* Tilted dashboard preview. The leftover brand-gradient
            blur layer that used to sit behind the placeholder was
            removed 2026-05-28 — the page-level violet glow +
            `HeroImageGlow` light-bar stack already provide the
            chrome, the extra back layer was just doubling up. */}
        <div className="relative mx-auto max-w-5xl" style={{ perspective: "1000px" }}>
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
            {/* Glow stack — 4 layered radial-gradient bars sitting at
                the image's top edge to build a "light source above
                the dashboard" halo. Recipe lifted from
                crypton-template.framer.website (2026-05-28); the
                hero's brand-violet `rgb(119, 51, 255)` was retargeted
                to our `--tq-violet` token (#7D2DFF — same hue, one
                shade off). Each bar is absolutely positioned at
                `bottom-full` of the image so they stack just above
                the rounded corners without being clipped by the
                image's `overflow-hidden`. */}
            <HeroImageGlow />

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
                `rounded-2xl` border with a shared bottom-fade
                `mask-image` (opaque from top → transparent at the
                bottom) — so the lower edge dissolves into the page
                background instead of sitting on a hard rectangular
                line. Top + sides stay crisp. */}
            <div
              className="relative mx-auto w-full overflow-hidden rounded-2xl border border-[var(--tq-border-glass)]"
              style={{
                maskImage:
                  "linear-gradient(to bottom, #000 60%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, #000 60%, transparent 100%)",
              }}
            >
              {/* Browser chrome — Mac Safari recipe: colored traffic
                  lights, paired ‹ › nav arrows, shield, URL pill with
                  lock + domain + refresh, and a right-side action
                  cluster (download / share / + / all-tabs). Forced
                  `dir="ltr"` so the URL + chrome read left-to-right
                  inside an RTL page; traffic lights stay anchored to
                  the visual left as users expect from real browsers.
                  All surfaces (nav buttons, URL pill, right cluster)
                  use the design-system tokens (`--tq-bg-glass`,
                  `--tq-border-glass`, `--tq-text-muted`) so the bar
                  inherits the same glass language as the rest of the
                  app — no hardcoded surface colors. */}
              <BrowserChromeBar path={demoPath} />

              {/* Interactive dashboard preview — aspect-[3/2] preserves
                  the same outer ratio the static hero.png used (1440 ×
                  960). The DashboardPreview's content scales within
                  this box; its absolutely-positioned inner pane fills
                  the aspect container so the chrome bar above stays
                  in proportion. */}
              <div className="relative aspect-[3/2] w-full">
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
// tokens (`--tq-bg-glass`, `--tq-border-glass`, `--tq-text-muted`)
// so the bar inherits the same glass language as the dashboard
// header below it — no hardcoded surface colors.
//
// Traffic lights are rendered as GLASS DOTS (not red/yellow/green) —
// user direction "make it with our glass css" trumps the macOS-color
// motif from the screenshot. Same `bg-white/15` recipe the auth
// header dots use elsewhere in the system; no hardcoded hex.
// Icon glyphs are Material Symbols Outlined.
//
// Right cluster intentionally renders 4 icon buttons (download /
// share / new-tab-plus / all-tabs grid) at the same affordance
// weight as the left-side nav arrows so the bar reads as a real
// Safari window, not a stripped-down minimal mock.

function BrowserChromeBar({ path }: { path: string }) {
  // Reusable "glass icon" recipe. These chrome controls are purely
  // decorative (no handlers) so they render as `aria-hidden` spans,
  // not focusable buttons — they're a browser mockup, not real
  // affordances. Pure tokens, no hardcoded color.
  const iconBtnCls =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--tq-text-muted)] transition-colors hover:bg-white/5 hover:text-white";

  return (
    <div
      dir="ltr"
      className="flex items-center gap-2 border-b border-[var(--tq-border-glass)] bg-[var(--tq-bg-glass)] px-3 py-2"
    >
      {/* Traffic lights — macOS-colored (close-red, minimize-yellow,
          expand-green) per user direction 2026-05-28. These are
          universally-recognized OS chrome colors, not brand surfaces,
          so they're hardcoded here as an explicit exception to the
          "never hardcode" rule — same approach taken by every other
          Mac browser mockup. Anchored visual-left. */}
      <div className="flex shrink-0 items-center gap-1.5 pr-1">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
      </div>

      {/* Sidebar toggle — Safari's leftmost chrome button after the
          traffic lights. */}
      <span aria-hidden className={iconBtnCls}>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          dock_to_right
        </span>
      </span>

      {/* Back / forward nav arrows — paired glass affordance. */}
      <div className="flex items-center gap-0.5">
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            chevron_left
          </span>
        </span>
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            chevron_right
          </span>
        </span>
      </div>

      {/* URL pill — shield + lock + domain + refresh. Centered via
          `flex-1` cluster so it tracks the bar width on resize. */}
      <div className="flex flex-1 items-center justify-center px-2">
        <div className="flex w-full max-w-[280px] items-center gap-1.5 rounded-md border border-[var(--tq-border-glass)] bg-black/25 px-2 py-1 text-[11px] text-[var(--tq-text-muted)]">
          <span
            className="material-symbols-outlined shrink-0"
            style={{ fontSize: 12 }}
            aria-hidden
          >
            shield
          </span>
          <span
            className="material-symbols-outlined shrink-0"
            style={{ fontSize: 12 }}
            aria-hidden
          >
            lock
          </span>
          <span className="flex-1 truncate text-center font-mono">
            taqreer.ai{path}
          </span>
          <span
            className="material-symbols-outlined shrink-0"
            style={{ fontSize: 12 }}
            aria-hidden
          >
            refresh
          </span>
        </div>
      </div>

      {/* Right cluster — download, share, new tab, all tabs. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            download
          </span>
        </span>
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            ios_share
          </span>
        </span>
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            add
          </span>
        </span>
        <span aria-hidden className={iconBtnCls}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            grid_view
          </span>
        </span>
      </div>
    </div>
  );
}

// ─── Glow stack ──────────────────────────────────────────────────
// Four layered radial-gradient bars sitting at the image's top edge.
// Per-bar widths + blurs + opacities lifted verbatim from the
// crypton-template Framer hero — together they build a "light source
// above the dashboard" effect (a bright thin core, a wider halo,
// and a wide ambient diffusion behind it). All bars share the same
// brand `--tq-violet` (or pure white for the topmost highlight line)
// so the glow stays one-token.

const VIOLET_RADIAL =
  "radial-gradient(50% 50%, rgba(var(--tq-violet-rgb), 1) 0%, rgba(var(--tq-violet-rgb), 0.4) 100%)";

const WHITE_RADIAL =
  "radial-gradient(50% 50%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 100%)";

// Bar specs in stacking order (visually back → front). Each bar
// anchors to `bottom-full` of the image wrapper and centers via
// `left-1/2 -translate-x-1/2`, so widths are relative to the
// image's width. Heights are fixed px since they read as light
// bars regardless of viewport size.
const GLOW_BARS: Array<{
  width: string;
  height: number;
  blur: number;
  opacity: number;
  bg: string;
  /** Vertical offset from the wrapper's bottom edge (negative = push
   *  the bar down, so it overlaps the top of the dashboard image). */
  offset?: number;
}> = [
  // L1 — wide ambient diffusion. Empty bg + heavy blur acts as a
  // soft "page-light" that the lower bars sit on top of. Offset
  // pulls it down behind the top edge of the dashboard so the
  // diffuse halo wraps the chrome rather than floating above it.
  { width: "100%", height: 155, blur: 64, opacity: 0.1, bg: VIOLET_RADIAL, offset: -60 },
  // L2 — widened bar that sits behind the top edge of the dashboard
  // for a corner-halo effect (user direction 2026-05-28). The
  // negative `offset` pulls the bar down past the wrapper's bottom
  // edge so most of it overlaps the dashboard's chrome bar.
  // Custom gradient (`50% 60%` ellipse + `120 %` stop) extends the
  // soft violet falloff vertically past the bar's box.
  {
    width: "103%",
    height: 92,
    blur: 20,
    opacity: 0.2,
    bg: "radial-gradient(50% 60%, rgba(var(--tq-violet-rgb), 1) 0%, rgba(var(--tq-violet-rgb), 0.4) 120%)",
    offset: -70,
  },
  // L3 — crisp violet core line just above the dashboard edge.
  { width: "42%",  height: 3,  blur: 8,  opacity: 0.8, bg: VIOLET_RADIAL },
  // L4 — the bright thin white line that visually grounds the
  // halo. Sits at zero blur and full opacity so it reads crisp.
  { width: "57%",  height: 2,  blur: 0,  opacity: 1,   bg: WHITE_RADIAL },
];

function HeroImageGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-full left-0 right-0"
    >
      {GLOW_BARS.map((bar, i) => (
        <div
          key={i}
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            // `bottom: 0` anchors the bar to the wrapper's bottom
            // edge (which sits exactly at the dashboard image's top
            // edge, since the wrapper is `bottom-full` of the
            // image). A negative `offset` pushes the bar down past
            // that edge so it overlaps the dashboard chrome.
            bottom: bar.offset ?? 0,
            width: bar.width,
            height: bar.height,
            background: bar.bg,
            filter: bar.blur > 0 ? `blur(${bar.blur}px)` : undefined,
            opacity: bar.opacity,
          }}
        />
      ))}
    </div>
  );
}

