"use client";

// ─── Datasheet-flow feature animation ─────────────────────────────
//
// Storyboard (plays once on hover, resets on hover-out):
//
//   1. Rest: 2 slides side by side, each showing a plain DATA TABLE
//      (grey title, violet header row, a grid of cell-marks). The two
//      tables differ (3-column / 2-column) — not copies.
//   2. A solid violet scan line (same primitive as Enhance + Mimic)
//      sweeps left→right across the row at constant speed.
//   3. As the line crosses each slide, that slide crossfades from its
//      data table into a CHART — slide 1 → bar chart, slide 2 →
//      trend line — each with a violet accent + logo dot. The data
//      becomes the presentation.
//
//   Same layout + mechanic as the Enhance flow (2 centred slides,
//   58 × 72, linear scan, staggered crossfade). Family stroke
//   vocabulary throughout: 0.85 outline / 0.55–0.7 lines / violet
//   accents, soft edge mask, viewBox 0 0 200 200.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { motion, useAnimate } from "framer-motion";

// Slide geometry — identical to the Enhance flow. Local centre
// (29, 36).
const SLIDE_W = 58;
const SLIDE_H = 72;

// 1 × 2 row, side by side, pre-centred in the 200×200 viewBox:
//   2 slides × 58 + 1 gap × 16 = 132  →  start x = (200−132)/2 = 34
//   x: 34 → 166 (centre 100 ✓)   y = (200−72)/2 = 64 → 64–136 (centre 100 ✓)
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

// Per-index content variants so the two slides read differently.
const PLAIN_VARIANTS = [PlainTableThreeCol, PlainTableTwoCol] as const;
const BRANDED_VARIANTS = [BrandedBarChart, BrandedLineChart] as const;

// Scan line — solid violet, no blur. Sweeps the row at LINEAR speed
// (so the per-slide crossfade delays stay locked to the bar's actual
// position — same lesson as the Enhance flow).
const SCAN_W = 2;
const SCAN_Y = SLIDE_Y - 4;
const SCAN_H = VH + 8;
const SCAN_START_X = ROW_X - 10; // just left of the row
const SCAN_END_X = ROW_X + ROW_W + 10; // just right of the row
const SCAN_DURATION = 1.4;

export type DatasheetFlowAnimationHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const DatasheetFlowAnimation = forwardRef<DatasheetFlowAnimationHandle>(
  function DatasheetFlowAnimation(_, ref) {
    const [scope, animate] = useAnimate();
    const runIdRef = useRef(0);

    const reset = useCallback(() => {
      SLIDES.forEach((_s, i) => {
        animate(`.table-${i}`, { opacity: 1 }, { duration: 0 });
        animate(`.chart-${i}`, { opacity: 0 }, { duration: 0 });
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
      animate(".scan-line", { opacity: 1 }, { duration: 0.15 });
      animate(
        ".scan-line",
        { x: SCAN_END_X },
        { duration: SCAN_DURATION, ease: "linear" },
      );

      // ── PHASE 2: each slide morphs table → chart as line passes ─
      SLIDES.forEach((s, i) => {
        const frac =
          (s.cx - SCAN_START_X) / (SCAN_END_X - SCAN_START_X);
        const delay = frac * SCAN_DURATION;
        animate(
          `.table-${i}`,
          { opacity: 0 },
          { duration: 0.45, delay, ease: "easeOut" },
        );
        animate(
          `.chart-${i}`,
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
          const Table = PLAIN_VARIANTS[i];
          const Chart = BRANDED_VARIANTS[i];
          return (
            <g
              key={i}
              transform={`translate(${s.x}, ${SLIDE_Y}) scale(${SLIDE_SCALE})`}
            >
              {/* Data-table layer */}
              <g className={`table-${i}`}>
                <Table />
              </g>
              {/* Chart layer — crossfades in atop the table */}
              <motion.g className={`chart-${i}`} initial={{ opacity: 0 }}>
                <Chart />
              </motion.g>
            </g>
          );
        })}

        {/* ─── SCAN LINE (solid violet, no blur) ────────────────── */}
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

export default DatasheetFlowAnimation;

// ─── Content variants ─────────────────────────────────────────────
//
// Plain = a data table (grey title, violet header row, grid of
// cell-marks). Branded = a chart built from that data. Family stroke
// vocabulary: 0.85 outline, 0.5–0.7 lines, violet accents.

// ── Slide 1 plain: 3-column table ──────────────────────────────────

function PlainTableThreeCol() {
  const cols = [8, 24, 40];
  const rows = [25, 34, 43, 52];
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Grey title */}
      <rect
        x="6"
        y="7"
        width="24"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      {/* Violet header row */}
      <rect
        x="6"
        y="16"
        width="46"
        height="3"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.5"
      />
      {/* 3 × 4 grid of cell-marks */}
      {rows.map((ry) =>
        cols.map((cx) => (
          <line
            key={`${cx}-${ry}`}
            x1={cx}
            y1={ry}
            x2={cx + 9}
            y2={ry}
            strokeOpacity="0.5"
          />
        )),
      )}
    </>
  );
}

// ── Slide 2 plain: 2-column table (distinct from slide 1) ──────────

function PlainTableTwoCol() {
  const cols = [8, 30];
  const rows = [25, 34, 43, 52];
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      <rect
        x="6"
        y="7"
        width="20"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      <rect
        x="6"
        y="16"
        width="46"
        height="3"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.5"
      />
      {/* 2 × 4 grid of wider cell-marks */}
      {rows.map((ry) =>
        cols.map((cx) => (
          <line
            key={`${cx}-${ry}`}
            x1={cx}
            y1={ry}
            x2={cx + 16}
            y2={ry}
            strokeOpacity="0.5"
          />
        )),
      )}
    </>
  );
}

// ── Slide 1 branded: bar chart ─────────────────────────────────────

function BrandedBarChart() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Violet title */}
      <rect
        x="6"
        y="7"
        width="28"
        height="4"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Baseline + bars (last bar violet — Create chart vocabulary) */}
      <line x1="6" y1="58" x2="52" y2="58" strokeOpacity="0.7" />
      <rect x="10" y="50" width="6" height="8" strokeOpacity="0.85" />
      <rect x="20" y="44" width="6" height="14" strokeOpacity="0.85" />
      <rect x="30" y="38" width="6" height="20" strokeOpacity="0.85" />
      <rect
        x="40"
        y="32"
        width="6"
        height="26"
        fill="var(--tq-violet)"
        stroke="var(--tq-violet)"
        opacity="0.85"
      />
      {/* Violet logo dot */}
      <circle
        cx="50"
        cy="65"
        r="2.5"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
    </>
  );
}

// ── Slide 2 branded: trend-line chart ──────────────────────────────

function BrandedLineChart() {
  return (
    <>
      <rect width={SLIDE_W} height={SLIDE_H} rx="3" strokeOpacity="0.85" />
      {/* Violet title */}
      <rect
        x="6"
        y="7"
        width="24"
        height="4"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Baseline + rising trend line; violet accent dot at the peak */}
      <line x1="6" y1="58" x2="52" y2="58" strokeOpacity="0.7" />
      <path d="M 8 52 L 20 46 L 32 40 L 46 30" strokeOpacity="0.85" />
      <circle cx="8" cy="52" r="1.5" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="20" cy="46" r="1.5" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="32" cy="40" r="1.5" fill="currentColor" stroke="none" opacity="0.6" />
      <circle
        cx="46"
        cy="30"
        r="2.5"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Violet logo dot */}
      <circle
        cx="50"
        cy="65"
        r="2.5"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
    </>
  );
}
