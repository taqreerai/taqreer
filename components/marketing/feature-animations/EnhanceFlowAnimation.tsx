"use client";

// ─── Enhance-flow feature animation ───────────────────────────────
//
// Storyboard (plays once on hover, resets on hover-out):
//
//   1. Rest: 2 plain slides side by side (grey title bars, ragged
//      lines, empty placeholders) — centred both axes. The two are
//      DIFFERENT layouts (text+chart / image+caption), not copies.
//   2. A solid violet scan line (no blur — same primitive as the
//      Mimic flow's line) sweeps left→right across the row.
//   3. As the line crosses each slide (staggered by the slide's
//      x-centre), that slide re-skins in place: grey title → violet,
//      its empty placeholder fills with a real branded element (a
//      bar chart / a captioned image illustration), and a violet
//      logo dot appears. The enhanced state is as rich as the Mimic
//      flow's left "result" slide.
//   End state: the same 2 slides, now fully on-brand.
//
//   Family consistency (user direction 2026-05-28): same viewBox,
//   stroke setup, HUMAN_EASE, soft edge mask, stroke opacities
//   (0.85 outline / 0.55 content lines / violet accents) and the
//   solid scan-line primitive as the Create + Mimic flows.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { motion, useAnimate } from "framer-motion";

// Slide geometry — bigger now that there are only two. Local centre
// (29, 36).
const SLIDE_W = 58;
const SLIDE_H = 72;

// 1 × 2 row, side by side. Pre-centred so the row's bounding box is
// dead-centre in the 200×200 viewBox:
//   2 slides × 58 + 1 gap × 16 = 132  →  start x = (200−132)/2 = 34
//   x: 34 → 166 (centre 100 ✓)   y = (200−72)/2 = 64 → 64–136 (centre 100 ✓)
// `cx` is each slide's x-centre, used to stagger the scan crossfade.
// Content is authored at SLIDE_W × SLIDE_H and rendered at
// SLIDE_SCALE via a scale wrapper, so the visual slides are a bit
// smaller without re-laying-out content. SLIDE_GAP adds extra margin
// between the two. Everything below is derived so the row stays
// dead-centre in the 200×200 viewBox. (User direction 2026-05-28:
// "make both slides a bit smaller with a little extra margin".)
const SLIDE_SCALE = 0.85;
const SLIDE_GAP = 24;
const VW = SLIDE_W * SLIDE_SCALE; // visual width
const VH = SLIDE_H * SLIDE_SCALE; // visual height
const ROW_W = 2 * VW + SLIDE_GAP;
const ROW_X = (200 - ROW_W) / 2;
const SLIDE_Y = (200 - VH) / 2;
const SLIDES = [
  { x: ROW_X, cx: ROW_X + VW / 2 },
  { x: ROW_X + VW + SLIDE_GAP, cx: ROW_X + VW + SLIDE_GAP + VW / 2 },
];

// Per-index content variants so the two slides read as DIFFERENT
// decks (user direction 2026-05-28: "make the two slides look
// different not copy paste").
const PLAIN_VARIANTS = [PlainSlideTextChart, PlainSlideImage] as const;
const BRANDED_VARIANTS = [BrandedSlideTextChart, BrandedSlideImage] as const;

// Scan line — solid violet vertical bar (NO blur/gradient), same as
// the Mimic flow's line. Sweeps left→right across the row. The rect's
// geometric x is 0; framer's `x` transform positions it.
const SCAN_W = 2;
const SCAN_Y = SLIDE_Y - 4;
const SCAN_H = VH + 8;
const SCAN_START_X = ROW_X - 10; // just left of the row
const SCAN_END_X = ROW_X + ROW_W + 10; // just right of the row
const SCAN_DURATION = 1.4;

export type EnhanceFlowAnimationHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const EnhanceFlowAnimation = forwardRef<EnhanceFlowAnimationHandle>(
  function EnhanceFlowAnimation(_, ref) {
    const [scope, animate] = useAnimate();
    const runIdRef = useRef(0);

    const reset = useCallback(() => {
      // Rest state = the plain row, fully present. Branded layers
      // hidden, scan parked off the left edge + invisible.
      SLIDES.forEach((_s, i) => {
        animate(`.plain-${i}`, { opacity: 1 }, { duration: 0 });
        animate(`.branded-${i}`, { opacity: 0 }, { duration: 0 });
      });
      animate(
        ".scan-line",
        { x: SCAN_START_X, opacity: 0 },
        { duration: 0 },
      );
    }, [animate]);

    const start = useCallback(async () => {
      runIdRef.current += 1;
      const myRun = runIdRef.current;
      reset();

      // ── PHASE 1: scan fades in + sweeps left→right ──────────
      // LINEAR sweep (not HUMAN_EASE): the per-slide crossfade delays
      // below are computed as `frac × duration`, which only lines up
      // with the bar's actual position if the bar moves at constant
      // speed. An eased sweep would make the bar reach the RIGHT
      // slide before its computed delay (the ease-out tail), so the
      // re-skin lagged behind the line. Linear keeps line + crossfade
      // locked together.
      animate(".scan-line", { opacity: 1 }, { duration: 0.15 });
      animate(
        ".scan-line",
        { x: SCAN_END_X },
        { duration: SCAN_DURATION, ease: "linear" },
      );

      // ── PHASE 2: each slide re-skins as the line crosses it ─
      // Crossfade delay = the fraction of the sweep at which the
      // scan line reaches that slide's x-centre.
      SLIDES.forEach((s, i) => {
        const frac =
          (s.cx - SCAN_START_X) / (SCAN_END_X - SCAN_START_X);
        const delay = frac * SCAN_DURATION;
        animate(
          `.plain-${i}`,
          { opacity: 0 },
          { duration: 0.45, delay, ease: "easeOut" },
        );
        animate(
          `.branded-${i}`,
          { opacity: 1 },
          { duration: 0.45, delay, ease: "easeOut" },
        );
      });

      await new Promise((r) =>
        setTimeout(r, (SCAN_DURATION + 0.15) * 1000),
      );
      if (runIdRef.current !== myRun) return;

      // ── PHASE 3: scan fades out at the right edge ───────────
      animate(".scan-line", { opacity: 0 }, { duration: 0.3 });
    }, [animate, reset]);

    const stop = useCallback(() => {
      runIdRef.current += 1;
      reset();
    }, [reset]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    useEffect(() => {
      reset();
    }, [reset]);

    return (
      <svg
        ref={scope}
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Shared soft edge mask (.mask-soft-edges) — same feather as
        // the other three flows.
        className="mask-soft-edges"
      >
        {/* ─── SLIDE ROW (left → right) ─────────────────────────── */}
        {SLIDES.map((s, i) => {
          const Plain = PLAIN_VARIANTS[i];
          const Branded = BRANDED_VARIANTS[i];
          return (
            <g
              key={i}
              transform={`translate(${s.x}, ${SLIDE_Y}) scale(${SLIDE_SCALE})`}
            >
              {/* Plain layer */}
              <g className={`plain-${i}`}>
                <Plain />
              </g>
              {/* Branded layer — crossfades in atop the plain one */}
              <motion.g className={`branded-${i}`} initial={{ opacity: 0 }}>
                <Branded />
              </motion.g>
            </g>
          );
        })}

        {/* ─── SCAN LINE (solid violet, no blur — same primitive as
              the Mimic flow). x positions via framer's transform. ── */}
        <motion.rect
          className="scan-line"
          x="0"
          y={SCAN_Y}
          width={SCAN_W}
          height={SCAN_H}
          fill="var(--tq-violet)"
          stroke="none"
          initial={{ x: SCAN_START_X, opacity: 0 }}
        />
      </svg>
    );
  },
);

export default EnhanceFlowAnimation;

// ─── Slide-content variants ───────────────────────────────────────
//
// Family stroke vocabulary throughout: crisp 0.85 outline, 0.55
// content lines, violet brand accents. Each slide has a distinct
// layout; plain → branded swaps the grey title for violet, fills the
// empty placeholder with a real branded element, and adds a logo dot.

// ── Slide 1: text + bar chart ──────────────────────────────────────

function PlainSlideTextChart() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Muted-grey title bar */}
      <rect
        x="6"
        y="7"
        width="26"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      {/* Ragged text lines */}
      <line x1="6" y1="19" x2="50" y2="19" strokeOpacity="0.55" />
      <line x1="6" y1="26" x2="40" y2="26" strokeOpacity="0.55" />
      <line x1="6" y1="33" x2="50" y2="33" strokeOpacity="0.55" />
      <line x1="6" y1="40" x2="36" y2="40" strokeOpacity="0.55" />
      {/* Empty placeholder box (becomes a chart once branded) */}
      <rect x="6" y="46" width="46" height="18" rx="2" strokeOpacity="0.4" />
    </>
  );
}

function BrandedSlideTextChart() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Violet title bar (wider — tightened + branded) */}
      <rect
        x="6"
        y="7"
        width="30"
        height="4"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Tidier text lines */}
      <line x1="6" y1="19" x2="48" y2="19" strokeOpacity="0.55" />
      <line x1="6" y1="26" x2="44" y2="26" strokeOpacity="0.55" />
      <line x1="6" y1="33" x2="50" y2="33" strokeOpacity="0.55" />
      {/* Bar chart — last bar violet, matching the Create flow's
          chart slide vocabulary. */}
      <line x1="6" y1="63" x2="52" y2="63" strokeOpacity="0.7" />
      <rect x="9" y="55" width="5" height="8" strokeOpacity="0.85" />
      <rect x="17" y="51" width="5" height="12" strokeOpacity="0.85" />
      <rect x="25" y="47" width="5" height="16" strokeOpacity="0.85" />
      <rect
        x="33"
        y="43"
        width="5"
        height="20"
        fill="var(--tq-violet)"
        stroke="var(--tq-violet)"
        opacity="0.85"
      />
      {/* Violet logo dot */}
      <circle
        cx="50"
        cy="67"
        r="2.5"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
    </>
  );
}

// ── Slide 2: image + caption ───────────────────────────────────────

function PlainSlideImage() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Muted-grey title bar */}
      <rect
        x="6"
        y="7"
        width="22"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      {/* Empty image placeholder (becomes an illustration once
          branded) */}
      <rect x="6" y="15" width="46" height="30" rx="2" strokeOpacity="0.4" />
      {/* Ragged caption lines */}
      <line x1="6" y1="52" x2="46" y2="52" strokeOpacity="0.55" />
      <line x1="6" y1="60" x2="34" y2="60" strokeOpacity="0.55" />
    </>
  );
}

function BrandedSlideImage() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Violet title bar */}
      <rect
        x="6"
        y="7"
        width="26"
        height="4"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Image area with mini-illustration (sun + mountains) — same
          vocabulary as the Mimic flow's left result slide. */}
      <rect x="6" y="15" width="46" height="30" rx="2" strokeOpacity="0.85" />
      <circle cx="15" cy="25" r="3" strokeOpacity="0.6" />
      <path
        d="M 6 45 L 18 32 L 30 38 L 42 28 L 52 34 L 52 45 L 6 45 Z"
        strokeOpacity="0.6"
      />
      {/* Tidier caption lines */}
      <line x1="6" y1="52" x2="48" y2="52" strokeOpacity="0.55" />
      <line x1="6" y1="60" x2="38" y2="60" strokeOpacity="0.55" />
      {/* Violet logo dot */}
      <circle
        cx="50"
        cy="67"
        r="2.5"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
    </>
  );
}
