"use client";

// Landing-page hero: centered title + subhead + CTA pair + scroll-tilted
// dashboard preview. Brand chrome references --tq-violet / .btn-gradient
// / .btn-pill / .text-muted to stay in lock-step with the dashboard.

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";

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
  const { scrollY } = useScroll();
  // 30° tilt at top → flat at 600 px scroll. Pure transform, no reflow.
  const rotateX = useTransform(scrollY, [0, 600], [30, 0]);

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
              <span
                className="flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
                style={{
                  background: "rgba(var(--tq-violet-rgb), 0.12)",
                  // Brand-violet text on a 12 %-alpha violet bg read
                  // as low-contrast against the dark page. Mix the
                  // brand violet with white in oklab (perceptually
                  // uniform) so the text lifts to a bright lavender
                  // that still reads as the brand colour, not a
                  // generic light tint. 30 % violet / 70 % white
                  // approximates `#E0D2FF` — high contrast on the
                  // dim violet pill.
                  color: "color-mix(in oklab, var(--tq-violet) 30%, white)",
                  border: "1px solid rgba(var(--tq-violet-rgb), 0.30)",
                }}
              >
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
            className="mb-8 w-full text-5xl font-bold leading-tight md:text-7xl"
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
            style={{ rotateX, transformStyle: "preserve-3d" }}
            className="relative origin-top"
          >
            {/* Glow stack — 6 layered radial-gradient bars sitting at
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

            {/* Real dashboard screenshot at /public/hero.png — captured
                via Playwright at 1440 × 960 (3:2). `priority` so it's
                in the initial render and doesn't pop in during the
                scroll-tilt animation.

                Bottom-fade mask: the wrapper carries a linear-gradient
                `mask-image` (opaque from top → transparent at the
                bottom) so the image's lower edge dissolves into the
                page background instead of sitting on a hard
                rectangular line. Mask also fades the border + the
                shadow's visual contribution at the bottom; the
                top/sides stay crisp. */}
            <div
              className="relative mx-auto aspect-[3/2] w-full overflow-hidden rounded-2xl border border-[var(--tq-border-glass)]"
              style={{
                // Bottom-only fade — image holds full opacity from
                // the top through 60 %, then dissolves to transparent
                // over the bottom 40 %. Top + sides stay crisp so the
                // dashboard chrome reads clearly; only the lower
                // edge blends into the page background.
                maskImage:
                  "linear-gradient(to bottom, #000 60%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, #000 60%, transparent 100%)",
              }}
            >
              <Image
                src="/hero.png"
                alt="لوحة تحكم تقرير — معاينة الواجهة"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="object-cover"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Glow stack ──────────────────────────────────────────────────
// Six layered radial-gradient bars sitting at the image's top edge.
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
}> = [
  // L1 — wide ambient diffusion. Empty bg + heavy blur acts as a
  // soft "page-light" that the lower bars sit on top of.
  { width: "100%", height: 155, blur: 64, opacity: 0.1, bg: VIOLET_RADIAL },
  { width: "95%",  height: 22,  blur: 20, opacity: 0.4, bg: VIOLET_RADIAL },
  { width: "60%",  height: 12,  blur: 20, opacity: 0.8, bg: VIOLET_RADIAL },
  { width: "57%",  height: 12,  blur: 4,  opacity: 0.2, bg: VIOLET_RADIAL },
  { width: "42%",  height: 3,   blur: 8,  opacity: 0.8, bg: VIOLET_RADIAL },
  // L6 — the bright thin white line that visually grounds the
  // halo. Sits at zero blur and full opacity so it reads crisp.
  { width: "57%",  height: 2,   blur: 0,  opacity: 1,   bg: WHITE_RADIAL },
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
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{
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
