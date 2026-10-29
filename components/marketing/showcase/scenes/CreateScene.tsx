"use client";

// ─── Create scene ────────────────────────────────────────────────────
// The landing hero's looping /create mini-tutorial, staged over the
// `.tq-aura` living-blue mesh + the design system's dot grid:
//   1 content card - the brief types out
//   2 brand card   - palette fills, font picked, then the cursor LEAVES
//                    the scene, returns DRAGGING the logo chip, hovers
//                    the dropzone (dragover highlight) and releases it
//   3 settings     - ratio 16:9 clicked, slide count stepped to 4
//   4 generate     - big centred CTA, click + sparkles, the 4 REAL deck
//                    slides fade in as a quick overlapping domino
//   5 finale       - fillers radiate outward while the slow-fast-slow
//                    zoom-out runs AND the marquee drift is already
//                    moving; full wall drifts ~4s before the loop.
//
// v3.3 (user review, 2026-08-09): cursor slowed down (real travel time
// between clicks - swatches 0.75s apart); 4-slide domino faster; row
// drift starts DURING the zoom-out; all three cards bigger; logo enters
// via a true drag-and-drop pantomime (exit -> re-enter with cargo ->
// dragover highlight -> release -> settle).
//
// Cursor positions are MEASURED from the live DOM (data-cur targets,
// lazy cache) so the tip always lands exactly; travel is quadratic-
// bezier with alternating bow + ease-in-out; every press is followed by
// a beat of dwell. All timings in SECONDS (total 25s), uneven on
// purpose. Reduced-motion renders the settled wall. Copy reads
// dict.flows so it can't drift.

import { useRef } from "react";
import {
  cubicBezier,
  motion,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  Cursor,
  ShowcaseKeyframes,
  Typing,
  useLoop,
} from "@/components/marketing/showcase/primitives";

// ─── Timeline (SECONDS) ──────────────────────────────────────────────
const DUR = 25;
const F = (s: number) => s / DUR;
const DURATION_MS = DUR * 1000;

// Card TRACK (v3.5): the three cards ride one sliding rail, SPACING%
// apart, advancing in the READING direction (LTR: next card arrives
// from the right; RTL mirrored) with the neighbours peeking at the
// edges - so ONE cursor glides card-to-card without leaving the frame.
const SPACING = 72; // % of stage width between card centres
const TRACK_T = [3.3, 4.05, 12.3, 13.1, 15.7, 16.4]; // slide windows (s)
const TRACK_POS = [0, 1, 1, 2, 2, 3]; // centred card index (3 = slid out)
const SLIDE_EASE = cubicBezier(0.45, 0, 0.25, 1);
const TRACK_FADE = [0.05, 0.35, 15.9, 16.35]; // track opacity window (s)
// Per-card active (full-focus) windows for the dim/scale treatment.
const CARD_DIM = 0.45;
const WALL = [16.2, 16.6, 24.75, 24.98].map(F);

const T_TYPE = [0.8, 2.7];
const PRESS_DELAY = 0.1; // press happens a beat after arrival

// Brand card beats (arrivals; presses at +0.1).
const SW_T = [4.55, 5.3, 6.05, 6.8];
const SW_PRESS = SW_T.map((t) => t + PRESS_DELAY);
const FONT_T = 7.75;
const FONT_PRESS = FONT_T + PRESS_DELAY;
const CAIRO_T = 8.45;
const CAIRO_PRESS = CAIRO_T + PRESS_DELAY;
// The drag: exit point off the card, then the dropzone release. Quick
// return (v3.4): ~0.7s back up with the chip.
const GRAB_T = 9.6; // arrives off-scene (picks the chip up)
const GRAB_DWELL = 0.3;
const DROP_T = 10.7; // arrives over the dropzone
const DROP_PRESS = DROP_T + PRESS_DELAY; // the release

// Settings beats.
const RATIO_T = 13.9;
const RATIO_PRESS = RATIO_T + PRESS_DELAY;
const PLUS_T = 14.85;
const PLUS_PRESS = PLUS_T + PRESS_DELAY;

// Generate + payoff + finale.
const GEN_PRESS = 17.35;
const FOCUS_T0 = 18.0;
const FOCUS_STEP = 0.22; // faster domino (v3.3)
const FOCUS_DUR = 0.5;
const FILLER_T0 = 18.7;
const FILLER_RING = 0.24;
const FILLER_DUR = 0.5;
const ZOOM = [18.9, 21.0];
const DRIFT = [19.2, 25]; // starts DURING the zoom-out (v3.3)

const ZOOM_EASE = cubicBezier(0.65, 0, 0.35, 1);

const DECK_PALETTE = ["#16343E", "#E8683A", "#7FA891", "#F2C14E"];

const BRIEF: Record<string, string> = {
  en: "Three quick tips to stay focused at work",
  ar: "ثلاث نصائح سريعة للتركيز في العمل",
};

// 4 rows x 6 tiles (v3.4: one row removed so the payoff block sits in
// the vertical middle), colour-mixed, 24 unique decks. Payoff at rows
// 1-2, cols 2-3. Bigger tiles (25.5%) keep the scene fully covered:
// 4 x 25.5 + 3 x 2.5 gaps = 109.5% of the stage height.
const WALL_ROWS: string[][] = [
  ["/showcase/wall-15.webp", "/showcase/wall-03.webp", "/showcase/wall-17.webp", "/showcase/wall-21.webp", "/showcase/wall-05.webp", "/showcase/wall-16.webp"],
  ["/showcase/wall-19.webp", "/showcase/wall-01.webp", "/showcase/focus-1.webp", "/showcase/focus-2.webp", "/showcase/wall-18.webp", "/showcase/wall-22.webp"],
  ["/showcase/wall-24.webp", "/showcase/wall-23.webp", "/showcase/focus-3.webp", "/showcase/focus-4.webp", "/showcase/wall-20.webp", "/showcase/wall-26.webp"],
  ["/showcase/wall-02.webp", "/showcase/wall-25.webp", "/showcase/wall-11.webp", "/showcase/wall-07.webp", "/showcase/wall-13.webp", "/showcase/wall-06.webp"],
];
// Domino order per cell, following the DECK's reading order. In LTR
// slide 1 sits top-left; in RTL the grid mirrors (slide 1 top-RIGHT,
// then leftward), so the cell -> order map flips with the locale.
const FOCUS_CELLS_LTR: Record<string, number> = {
  "1-2": 0,
  "1-3": 1,
  "2-2": 2,
  "2-3": 3,
};
const FOCUS_CELLS_RTL: Record<string, number> = {
  "1-3": 0,
  "1-2": 1,
  "2-3": 2,
  "2-2": 3,
};

export function CreateScene({ reduced = false }: { reduced?: boolean }) {
  const dict = useDict();
  const { dir, locale } = useLocale();
  const f = dict.flows;
  const loop = useLoop(DURATION_MS);
  const brief = BRIEF[locale] ?? BRIEF.en;
  // Arabic locale swaps in the translated + physically-mirrored payoff
  // deck renders (focus-ar-*.webp) AND mirrors the 2x2 reading order:
  // slide 1 top-RIGHT (c3), slide 2 top-left (c2), etc. Wall fillers
  // are shared between locales.
  const rows =
    locale === "ar"
      ? WALL_ROWS.map((row) => {
          const r = row.map((src) => src.replace("/focus-", "/focus-ar-"));
          if (r[2].includes("/focus-ar-")) [r[2], r[3]] = [r[3], r[2]];
          return r;
        })
      : WALL_ROWS;
  const focusCells = locale === "ar" ? FOCUS_CELLS_RTL : FOCUS_CELLS_LTR;
  // Rail direction follows the READING direction: LTR lays the next
  // card to the right (track slides left); RTL mirrors both.
  const sign = dir === "rtl" ? -1 : 1;

  return (
    // `.tq-aura` living-blue backdrop + the dashboard's dot field (both
    // restored 2026-08-30, user direction). The aura's light-theme
    // dark-island re-scope applies to cards only (.tq-aura.surface-card), so
    // this scene follows the light theme.
    <div aria-hidden className="tq-aura relative h-full w-full overflow-hidden" dir={dir} data-scene-root>
      {/* Dot field - the design system's tiled grid (.tq-dot-grid,
          token-driven), same texture as the dashboard panel. */}
      <div aria-hidden className="tq-dot-grid pointer-events-none absolute inset-0" />
      <ShowcaseKeyframes />

      {/* Card track (v3.5) - the three cards ride one sliding rail with
          neighbours peeking at the edges; ONE cursor glides across all
          of them without leaving the frame. */}
      {!reduced && (
        <CardTrack loop={loop} sign={sign}>
          {/* Card 1 - content (typing only, no cursor) */}
          <CardSlot
            i={0}
            sign={sign}
            loop={loop}
            fadeT={[3.3, 4.0]}
            fadeV={[1, CARD_DIM]}
          >
            <div className="surface-card flex w-full flex-col gap-3 rounded-2xl p-5">
              <CardHead icon="subject" title={f.contentCard} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground/70">{f.language}</span>
                <Seg options={[f.langArabic, f.langEnglish]} active={locale === "ar" ? 0 : 1} />
              </div>
              <div
                className="input-dark min-h-[76px] text-[13px] leading-relaxed text-foreground/90"
                style={{ padding: "11px 14px", borderRadius: 12 }}
              >
                <Typing text={brief} loop={loop} start={F(T_TYPE[0])} end={F(T_TYPE[1])} reduced={reduced} />
              </div>
              <Hairline />
              <GhostRow icon="cloud_upload" title={f.dropTitle} hint={f.dropSubtitle} dashed />
            </div>
          </CardSlot>

          {/* Card 2 - brand: palette + font + logo drag-and-drop */}
          <CardSlot
            i={1}
            sign={sign}
            loop={loop}
            fadeT={[3.3, 4.0, 12.3, 13.0]}
            fadeV={[CARD_DIM, 1, 1, CARD_DIM]}
          >
            <div className="surface-card flex w-full flex-col gap-3 rounded-2xl p-5">
              <CardHead icon="palette" title={f.brandCard} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground/70">{f.colors}</span>
                <div className="flex items-center gap-1.5">
                  {DECK_PALETTE.map((c, i) => (
                    <PopIn key={c} loop={loop} at={F(SW_PRESS[i])} reduced={reduced}>
                      <span
                        data-cur={`sw${i}`}
                        className="block h-7 w-7 rounded-md border border-foreground/15"
                        style={{ background: c }}
                      />
                    </PopIn>
                  ))}
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-foreground/25 text-foreground/50">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
                  </span>
                </div>
              </div>
              <Hairline />
              <FontPick loop={loop} label={f.fonts.fonts} reduced={reduced} />
              <Hairline />
              <LogoDrop loop={loop} label={f.logo} hint={f.brand.svgOnly} reduced={reduced} />
            </div>
          </CardSlot>

          {/* Card 3 - output settings: ratio + count */}
          <CardSlot
            i={2}
            sign={sign}
            loop={loop}
            fadeT={[12.3, 13.0]}
            fadeV={[CARD_DIM, 1]}
          >
            <div className="surface-card flex w-full flex-col gap-3.5 rounded-2xl p-5">
              <CardHead icon="settings" title={f.outputCard} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground/70">{f.output.slideSize}</span>
                <RatioPick loop={loop} at={F(RATIO_PRESS)} reduced={reduced} />
              </div>
              <Hairline />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground/70">{f.slideCount}</span>
                <CountStep loop={loop} at={F(PLUS_PRESS)} reduced={reduced} />
              </div>
            </div>
          </CardSlot>

          {/* ONE measured cursor for the whole rail: swatches -> font ->
              Cairo -> dives off-frame, returns DRAGGING the chip ->
              releases on the dropzone -> glides (with the slide) to the
              settings card -> ratio -> count -> dives out to the wall.
              Coordinates are TRACK %; card i centres at 50 + i*SPACING. */}
          <CardCursor
            loop={loop}
            sign={sign}
            appear={4.05}
            vanish={15.9}
            enter={{ x: 50 + SPACING * sign + 26 * sign, y: 140 }}
            exit={{ x: 50 + 2 * SPACING * sign, y: 145 }}
            stops={[
              ...SW_T.map((t, i) => ({ target: `sw${i}`, t, press: true })),
              { target: "font", t: FONT_T, press: true },
              { target: "cairo", t: CAIRO_T, press: true, dwell: 0.35 },
              // Off-frame grab BELOW the masked stage (measured live):
              // the cursor visibly dives out of the frame bottom, "picks
              // up" the logo, and returns carrying it from outside.
              {
                offBottom: true,
                point: { x: 50 + SPACING * sign - 2 * sign, y: 0 },
                t: GRAB_T,
                dwell: GRAB_DWELL,
              },
              // Long dwell: the cursor RESTS on the logo (riding with
              // card 2) through the whole 12.3-13.1 rail slide, and only
              // starts toward the ratio tile once card 3 has settled -
              // no cursor-motion-on-top-of-rail-motion (user, v3.5).
              { target: "logo", t: DROP_T, press: true, dwell: 2.35 },
              { target: "ratio", t: RATIO_T, press: true, dwell: 0.4 },
              { target: "plus", t: PLUS_T, press: true, dwell: 0.35 },
            ]}
            cargo={{
              from: GRAB_T + GRAB_DWELL - 0.05,
              to: DROP_PRESS,
              node: <LogoChip />,
            }}
          />
        </CardTrack>
      )}

      {/* Wall layer - generate + domino payoff + gradient-fill finale */}
      <WallLayer
        loop={loop}
        reduced={reduced}
        cta={f.generate.create}
        dir={dir}
        rows={rows}
        focusCells={focusCells}
      />
    </div>
  );
}

// ─── Card track (v3.5) ───────────────────────────────────────────────
// One sliding rail carrying the three cards SPACING% apart. The rail is
// also the cursor's coordinate space (data-cur-root sits on the SLIDING
// element, so the cursor and its measured targets share one moving
// frame and glide together during transitions). Neighbours peek at the
// stage edges; the rail eases card-to-card with slow-fast-slow.
function CardTrack({
  loop,
  sign,
  children,
}: {
  loop: MotionValue<number>;
  sign: 1 | -1;
  children: React.ReactNode;
}) {
  const opacity = useTransform(loop, TRACK_FADE.map(F), [0, 1, 1, 0]);
  const x = useTransform(
    loop,
    TRACK_T.map(F),
    TRACK_POS.map((p) => `${-p * SPACING * sign}%`),
    { ease: SLIDE_EASE },
  );
  return (
    <motion.div className="absolute inset-0 z-10" style={{ opacity }}>
      <motion.div className="absolute inset-0" style={{ x }} data-cur-root>
        {children}
      </motion.div>
    </motion.div>
  );
}

// One card on the rail: a full-stage slot shifted i*SPACING% along the
// reading direction, centring its card. Inactive cards dim + shrink a
// touch so the centred card carries the focus.
function CardSlot({
  i,
  sign,
  loop,
  fadeT,
  fadeV,
  children,
}: {
  i: number;
  sign: 1 | -1;
  loop: MotionValue<number>;
  fadeT: number[]; // seconds
  fadeV: number[]; // opacity keyframes (1 = active, CARD_DIM = peeking)
  children: React.ReactNode;
}) {
  const opacity = useTransform(loop, fadeT.map(F), fadeV);
  const scale = useTransform(
    loop,
    fadeT.map(F),
    fadeV.map((v) => (v === 1 ? 1 : 0.96)),
  );
  return (
    // data-slot: the cursor's offset-chain measurement resolves targets
    // relative to this stage-sized box, then adds i*SPACING*sign (the
    // rail translate below never appears in layout offsets).
    <motion.div
      data-slot={i}
      className="absolute inset-0 flex items-center justify-center"
      style={{ x: `${i * SPACING * sign}%` }}
    >
      {/* Width lives on this wrapper (a % width on the card itself would
          resolve against a shrink-wrapped box and collapse). */}
      <motion.div className="relative w-[min(500px,66%)]" style={{ opacity, scale }}>
        {children}
      </motion.div>
    </motion.div>
  );
}

// ─── Measured, humanized cursor (with optional drag cargo) ──────────
type CursorStop = {
  target?: string; // data-cur to land on (measured)
  point?: { x: number; y: number }; // or a literal card-% point
  // Measured off-frame point BELOW the stage clip edge (x from `point`,
  // y = stage bottom + margin) - guarantees the cursor fully exits the
  // masked frame at ANY stage size (the drag "grab" beat).
  offBottom?: boolean;
  t: number; // arrival (seconds); press fires at t + PRESS_DELAY
  press?: boolean;
  dwell?: number; // rest AFTER the beat (default 0.3)
};

const DEFAULT_DWELL = 0.3;

function easeInOutCubic(u: number) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function CardCursor({
  loop,
  appear,
  vanish,
  enter,
  exit,
  stops,
  cargo,
  sign = 1,
  size = 34,
}: {
  loop: MotionValue<number>;
  appear: number;
  vanish: number;
  enter: { x: number; y: number };
  exit: { x: number; y: number };
  stops: CursorStop[];
  // Dragged payload: rendered at the cursor tip during [from, to] (s).
  cargo?: { from: number; to: number; node: React.ReactNode };
  // Rail direction (mirrors slot offsets under RTL).
  sign?: 1 | -1;
  size?: number;
}) {
  const selfRef = useRef<HTMLDivElement>(null);
  const ptsRef = useRef<{ x: number; y: number }[] | null>(null);

  // TRANSFORM-IMMUNE measurement (v3.6): the hero tilts the whole frame
  // in 3D (perspective rotateX), so getBoundingClientRect returns the
  // PROJECTED rects - percentages derived from them land off-target in
  // local space. Instead, walk the offsetLeft/Top chain (pure layout,
  // untouched by transforms) from the target up to its [data-slot]
  // wrapper, then add the slot's KNOWN rail offset (i * SPACING * sign,
  // applied via transform so it never shows up in offsets).
  const getPts = () => {
    if (ptsRef.current) return ptsRef.current;
    if (typeof document === "undefined") return null;
    const root = selfRef.current?.closest("[data-cur-root]") as HTMLElement | null;
    if (!root) return null;
    if (root.offsetWidth === 0) return null;
    const pts: { x: number; y: number }[] = [];
    for (const s of stops) {
      if (s.offBottom) {
        // Local coords: the stage box is exactly 100% of the root's
        // height, so 130% parks the whole tip-anchored cursor safely
        // past the overflow-hidden bottom at any stage size.
        pts.push({ x: s.point?.x ?? 50, y: 130 });
        continue;
      }
      if (s.point) {
        pts.push(s.point);
        continue;
      }
      const el = root.querySelector(`[data-cur="${s.target}"]`) as HTMLElement | null;
      if (!el) return null;
      const slot = el.closest("[data-slot]") as HTMLElement | null;
      if (!slot || slot.offsetWidth === 0) return null;
      const slotIndex = Number(slot.dataset.slot) || 0;
      let x = el.offsetWidth / 2;
      let y = el.offsetHeight / 2;
      let node: HTMLElement | null = el;
      while (node && node !== slot && slot.contains(node)) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      pts.push({
        x: (x / slot.offsetWidth) * 100 + slotIndex * SPACING * sign,
        y: (y / slot.offsetHeight) * 100,
      });
    }
    ptsRef.current = pts;
    return pts;
  };

  const posAt = (tSec: number) => {
    const pts = getPts();
    if (!pts) return enter;
    const arr = stops.map((s) => s.t);
    const dep = stops.map(
      (s) => s.t + (s.press ? PRESS_DELAY : 0) + (s.dwell ?? DEFAULT_DWELL),
    );
    const P = [enter, ...pts, exit];
    const t0s = [appear, ...dep];
    const t1s = [...arr, vanish];
    for (let i = 0; i < P.length - 1; i++) {
      if (tSec < t0s[i]) return P[i];
      if (tSec <= t1s[i]) {
        const u = easeInOutCubic((tSec - t0s[i]) / Math.max(t1s[i] - t0s[i], 0.001));
        const p0 = P[i];
        const p1 = P[i + 1];
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(14, len * 0.22) * (i % 2 === 0 ? 1 : -1);
        const cx = mx + (-dy / len) * bow;
        const cy = my + (dx / len) * bow;
        const w = 1 - u;
        return {
          x: w * w * p0.x + 2 * w * u * cx + u * u * p1.x,
          y: w * w * p0.y + 2 * w * u * cy + u * u * p1.y,
        };
      }
    }
    return exit;
  };

  const xPct = useTransform(loop, (v) => posAt(v * DUR).x);
  const yPct = useTransform(loop, (v) => posAt(v * DUR).y);
  // PHYSICAL left: measured rects are physical; the card content already
  // mirrors itself under RTL.
  const left = useTransform(xPct, (v) => `${v}%`);
  const top = useTransform(yPct, (v) => `${v}%`);
  const opacity = useTransform(
    loop,
    [F(appear - 0.15), F(appear + 0.15), F(vanish - 0.2), F(vanish + 0.1)],
    [0, 1, 1, 0],
  );
  const presses = stops.filter((s) => s.press).map((s) => s.t + PRESS_DELAY);
  const scale = useTransform(
    loop,
    presses.flatMap((p) => [F(p - 0.12), F(p), F(p + 0.12), F(p + 0.24)]),
    presses.flatMap(() => [1, 0.72, 1.14, 1]),
  );
  const cargoOpacity = useTransform(
    loop,
    cargo
      ? [F(cargo.from - 0.12), F(cargo.from), F(cargo.to), F(cargo.to + 0.08)]
      : [0, 0.001, 0.002, 0.003],
    cargo ? [0, 1, 1, 0] : [0, 0, 0, 0],
  );

  return (
    <motion.div
      ref={selfRef}
      aria-hidden
      className="pointer-events-none absolute z-30"
      style={{ left, top, x: "-50%", y: "-8%", opacity, scale }}
    >
      <Cursor size={size} />
      {/* Dragged cargo rides just under the tip, like a held object. */}
      {cargo && (
        <motion.div
          className="absolute"
          style={{ left: size * 0.42, top: size * 0.62, opacity: cargoOpacity }}
        >
          {cargo.node}
        </motion.div>
      )}
    </motion.div>
  );
}

// The logo chip visual (shared by the drag cargo + the settled slot).
function LogoChip({ size = 28 }: { size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-md"
      style={{ width: size, height: size, backgroundImage: "var(--tq-gradient-brand)" }}
    >
      <span className="text-[10px] font-black text-white">T</span>
    </span>
  );
}

// ─── Small card pieces ───────────────────────────────────────────────
function CardHead({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--tq-border-hairline)] pb-2.5">
      <span className="material-symbols-outlined text-foreground" style={{ fontSize: 16 }}>
        {icon}
      </span>
      <span className="text-[13px] font-semibold text-foreground">{title}</span>
    </div>
  );
}

function Hairline() {
  return <div className="border-t border-[var(--tq-border-hairline)]" />;
}

function Seg({ options, active }: { options: string[]; active: number }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-0.5">
      {options.map((label, i) => (
        <span
          key={i}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            i === active ? "bg-[var(--tq-blue)] text-white" : "text-foreground/60"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function GhostRow({
  icon,
  title,
  hint,
  dashed = false,
}: {
  icon: string;
  title: string;
  hint: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border ${
        dashed ? "border-dashed border-foreground/20" : "border-[var(--tq-border-hairline)]"
      } bg-overlay-soft p-3`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)]">
        <span className="material-symbols-outlined text-foreground/80" style={{ fontSize: 15 }}>
          {icon}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-foreground/40">{hint}</p>
      </div>
    </div>
  );
}

function PopIn({
  loop,
  at,
  reduced,
  children,
}: {
  loop: MotionValue<number>;
  at: number;
  reduced: boolean;
  children: React.ReactNode;
}) {
  const opacity = useTransform(loop, [at, at + F(0.25)], [0, 1]);
  const scale = useTransform(loop, [at, at + F(0.25), at + F(0.6)], [0.4, 1.15, 1]);
  if (reduced) return <>{children}</>;
  return <motion.span style={{ opacity, scale }}>{children}</motion.span>;
}

const FONT_OPTIONS = ["Cairo", "Inter", "Rubik"];
function FontPick({
  loop,
  label,
  reduced,
}: {
  loop: MotionValue<number>;
  label: string;
  reduced: boolean;
}) {
  const popOpacity = useTransform(
    loop,
    [F(FONT_PRESS + 0.05), F(FONT_PRESS + 0.25), F(CAIRO_PRESS + 0.4), F(CAIRO_PRESS + 0.6)],
    [0, 1, 1, 0],
  );
  const popY = useTransform(loop, [F(FONT_PRESS + 0.05), F(FONT_PRESS + 0.25)], [4, 0]);
  const pickBg = useTransform(
    loop,
    [F(CAIRO_PRESS), F(CAIRO_PRESS + 0.15)],
    ["rgba(var(--tq-purple-rgb),0)", "rgba(var(--tq-purple-rgb),0.18)"],
  );
  const slotOld = useTransform(loop, [F(CAIRO_PRESS + 0.5), F(CAIRO_PRESS + 0.65)], [1, 0]);
  const slotNew = useTransform(loop, [F(CAIRO_PRESS + 0.5), F(CAIRO_PRESS + 0.65)], [0, 1]);
  return (
    <div className="relative flex items-center justify-between">
      <span className="text-[11px] font-semibold text-foreground/70">{label}</span>
      <div
        data-cur="font"
        className="relative flex items-center justify-between rounded-md border border-[var(--tq-border-hairline)] bg-overlay-soft px-2.5"
        style={{ height: 32, width: 170 }}
      >
        <span className="text-[11px] text-[var(--tq-text-muted)]">Aa</span>
        {reduced ? (
          <span className="text-[12px] font-semibold text-foreground">Cairo</span>
        ) : (
          <span className="relative text-[12px] font-semibold text-foreground">
            <motion.span style={{ opacity: slotOld }} className="text-foreground/35">
              --
            </motion.span>
            <motion.span style={{ opacity: slotNew }} className="absolute inset-y-0 end-0">
              Cairo
            </motion.span>
          </span>
        )}
        {!reduced && (
          <motion.div
            className="surface-menu absolute end-0 top-full z-20 mt-1 flex w-[170px] flex-col rounded-lg p-1"
            style={{ opacity: popOpacity, y: popY }}
          >
            {FONT_OPTIONS.map((name, i) => (
              <motion.span
                key={name}
                data-cur={i === 0 ? "cairo" : undefined}
                className="rounded-md px-2.5 py-1.5 text-[12px] text-foreground"
                style={i === 0 ? { background: pickBg, fontFamily: "Cairo" } : undefined}
              >
                {name}
              </motion.span>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// Logo dropzone: dragover highlight while the cursor hovers with cargo,
// then the chip settles in on release.
function LogoDrop({
  loop,
  label,
  hint,
  reduced,
}: {
  loop: MotionValue<number>;
  label: string;
  hint: string;
  reduced: boolean;
}) {
  // Dragover highlight: brightens as the drag approaches/hovers, pulses
  // at the release, then fades.
  const outlineColor = useTransform(
    loop,
    [F(DROP_T - 0.4), F(DROP_T), F(DROP_PRESS + 0.25), F(DROP_PRESS + 0.75)],
    [
      "rgba(var(--tq-purple-rgb),0)",
      "rgba(var(--tq-purple-rgb),0.55)",
      "rgba(var(--tq-purple-rgb),0.8)",
      "rgba(var(--tq-purple-rgb),0)",
    ],
  );
  const bgTint = useTransform(
    loop,
    [F(DROP_T - 0.4), F(DROP_T), F(DROP_PRESS + 0.4), F(DROP_PRESS + 0.8)],
    [
      "rgba(var(--tq-purple-rgb),0)",
      "rgba(var(--tq-purple-rgb),0.07)",
      "rgba(var(--tq-purple-rgb),0.07)",
      "rgba(var(--tq-purple-rgb),0)",
    ],
  );
  // The settled chip appears at the release with a small settle,
  // crossfading from the dropzone's upload icon (same circular icon
  // treatment as the content dropzone).
  const chipOpacity = useTransform(loop, [F(DROP_PRESS), F(DROP_PRESS + 0.12)], [0, 1]);
  const chipScale = useTransform(loop, [F(DROP_PRESS), F(DROP_PRESS + 0.12), F(DROP_PRESS + 0.4)], [1.25, 1.08, 1]);
  const iconOpacity = useTransform(loop, [F(DROP_PRESS), F(DROP_PRESS + 0.12)], [1, 0]);
  return (
    <motion.div
      data-cur="logo"
      className="flex items-center gap-2.5 rounded-xl border border-dashed border-foreground/20 p-3"
      style={
        reduced
          ? { background: "var(--tq-overlay-soft)" }
          : {
              background: bgTint,
              outline: "1.5px solid",
              outlineColor,
              outlineOffset: -1,
            }
      }
    >
      <span className="relative h-8 w-8 shrink-0">
        <motion.span
          className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--tq-surface)]"
          style={{ opacity: reduced ? 0 : iconOpacity }}
        >
          <span className="material-symbols-outlined text-foreground/80" style={{ fontSize: 15 }}>
            image
          </span>
        </motion.span>
        <motion.span
          className="absolute inset-0"
          style={reduced ? undefined : { opacity: chipOpacity, scale: chipScale }}
        >
          <LogoChip size={32} />
        </motion.span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 truncate text-[10px] text-foreground/40">{hint}</p>
      </div>
    </motion.div>
  );
}

function RatioPick({
  loop,
  at,
  reduced,
}: {
  loop: MotionValue<number>;
  at: number;
  reduced: boolean;
}) {
  // The selected state fades in as an OVERLAY (accent border + tint)
  // animated by opacity: framer cannot interpolate between CSS-var color
  // strings, so animating border-color snapped instead of easing
  // (CR PR #193).
  const selectedOpacity = useTransform(loop, [at, at + F(0.15)], [0, 1]);
  return (
    <div className="flex items-center gap-1.5">
      <span
        data-cur="ratio"
        className="relative flex items-center gap-1.5 rounded-lg border border-[var(--tq-border-hairline)] px-2.5 py-1.5"
      >
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border border-[var(--tq-blue)]"
          style={{
            background: "rgba(var(--tq-blue-rgb),0.1)",
            opacity: reduced ? 1 : selectedOpacity,
          }}
        />
        <span className="rounded-xs border border-foreground/40" style={{ width: 18, height: 10 }} />
        <span dir="ltr" className="text-[11px] font-semibold text-foreground tabular-nums">16:9</span>
      </span>
      <span className="flex items-center gap-1.5 rounded-lg border border-[var(--tq-border-hairline)] px-2.5 py-1.5 opacity-60">
        <span className="rounded-xs border border-foreground/40" style={{ width: 10, height: 16 }} />
        <span dir="ltr" className="text-[11px] font-semibold text-foreground/70 tabular-nums">9:16</span>
      </span>
    </div>
  );
}

function CountStep({
  loop,
  at,
  reduced,
}: {
  loop: MotionValue<number>;
  at: number;
  reduced: boolean;
}) {
  const oldOp = useTransform(loop, [at, at + F(0.12)], [1, 0]);
  const newOp = useTransform(loop, [at, at + F(0.12)], [0, 1]);
  const bump = useTransform(loop, [at, at + F(0.18), at + F(0.5)], [1, 1.25, 1]);
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--tq-border-hairline)] text-foreground/60">
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>remove</span>
      </span>
      <span className="relative inline-flex w-5 justify-center text-[15px] font-bold text-foreground tabular-nums">
        {reduced ? (
          "4"
        ) : (
          <>
            <motion.span style={{ opacity: oldOp }}>3</motion.span>
            <motion.span className="absolute inset-0 flex justify-center" style={{ opacity: newOp, scale: bump }}>
              4
            </motion.span>
          </>
        )}
      </span>
      <motion.span
        data-cur="plus"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--tq-blue)] text-[var(--tq-blue)]"
        style={reduced ? undefined : { scale: bump }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>add</span>
      </motion.span>
    </div>
  );
}

// ─── Wall layer ──────────────────────────────────────────────────────
// 4 rows centred: row centres sit at y 8 / 36 / 64 / 92, so the rows 1-2
// payoff block centres at y 50 - dead centre, NO pre-zoom shift needed.
// Tiles 25.5% + 2% gaps; focus rows base -31.5 puts the block centre at
// x 50 (c2..c3 span base+55 .. base+108).
const WALL_ORIGIN = { x: 50, y: 50 };
const ROW_BASE_X = [-20, -31.5, -31.5, -25];
const ROW_DRIFT = [4, -4.5, 4.5, -4];

function WallLayer({
  loop,
  reduced,
  cta,
  dir,
  rows,
  focusCells,
}: {
  loop: MotionValue<number>;
  reduced: boolean;
  cta: string;
  dir: "rtl" | "ltr";
  // Locale-resolved wall rows (Arabic swaps the payoff deck renders).
  rows: string[][];
  // Locale-resolved cell -> domino order (mirrored under RTL).
  focusCells: Record<string, number>;
}) {
  const [i0, i1, o0, o1] = WALL;
  const opacity = useTransform(loop, [i0, i1, o0, o1], [0, 1, 1, 0]);
  // 1.6x: the centred 2x2 block keeps clear margins while zoomed.
  const scale = useTransform(loop, ZOOM.map(F), [1.6, 1], { ease: ZOOM_EASE });
  const btnScale = useTransform(
    loop,
    [F(GEN_PRESS - 0.12), F(GEN_PRESS), F(GEN_PRESS + 0.12), F(GEN_PRESS + 0.24)],
    [1, 0.9, 1.06, 1],
  );
  const btnOpacity = useTransform(loop, [i0, i1, F(17.8), F(18.15)], [0, 1, 1, 0]);
  // Enters from BELOW the masked frame (y > 110% of the stage) at the
  // same bottom edge the settings-scene cursor exited through, and
  // leaves the same way - no mid-scene pop (user direction v3.4).
  const curX = useTransform(loop, [16.6, 16.95, GEN_PRESS - 0.15, 17.9, 18.3].map(F), [57, 53, 50.35, 52, 56]);
  const curY = useTransform(loop, [16.6, 16.95, GEN_PRESS - 0.15, 17.9, 18.3].map(F), [112, 74, 50.8, 54, 112]);
  const curLeft = useTransform(curX, (v) => `${v}%`);
  const curTop = useTransform(curY, (v) => `${v}%`);
  const curOpacity = useTransform(loop, [16.55, 16.65, 18.35, 18.45].map(F), [0, 1, 1, 0]);
  const curScale = useTransform(
    loop,
    [F(GEN_PRESS - 0.12), F(GEN_PRESS), F(GEN_PRESS + 0.12), F(GEN_PRESS + 0.24)],
    [1, 0.72, 1.14, 1],
  );

  return (
    // Explicit static opacity in reduced mode (never `undefined`): when
    // the lab toggle flips `reduced` mid-session, framer keeps the last
    // applied inline value - an `undefined` style would leave a stale
    // opacity:0 stuck on the node.
    <motion.div
      className="absolute inset-0"
      style={{ opacity: reduced ? 1 : opacity }}
      dir="ltr"
    >
      <motion.div
        className="absolute inset-0 flex flex-col justify-center gap-[2.5%]"
        style={{
          transformOrigin: `${WALL_ORIGIN.x}% ${WALL_ORIGIN.y}%`,
          scale: reduced ? 1 : scale,
        }}
      >
        {rows.map((row, r) => (
          <WallRow key={r} row={row} r={r} loop={loop} reduced={reduced} focusCells={focusCells} />
        ))}
      </motion.div>

      {!reduced && (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 z-20"
            style={{ x: "-50%", y: "-50%", opacity: btnOpacity, scale: btnScale }}
            dir={dir}
          >
            <span className="btn-gradient-anim inline-block rounded-full px-9 py-3 text-[16px] font-semibold">
              {cta}
            </span>
            <Sparkles loop={loop} at={F(GEN_PRESS)} />
          </motion.div>

          <motion.div
            aria-hidden
            className="pointer-events-none absolute z-30"
            style={{
              left: curLeft,
              top: curTop,
              x: "-50%",
              y: "-8%",
              opacity: curOpacity,
              scale: curScale,
            }}
          >
            <Cursor size={48} />
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

function WallRow({
  row,
  r,
  loop,
  reduced,
  focusCells,
}: {
  row: string[];
  r: number;
  loop: MotionValue<number>;
  reduced: boolean;
  focusCells: Record<string, number>;
}) {
  const x = useTransform(loop, DRIFT.map(F), [`${ROW_BASE_X[r]}%`, `${ROW_BASE_X[r] + ROW_DRIFT[r]}%`]);
  return (
    <motion.div
      className="flex w-full shrink-0 gap-[2%]"
      style={{ x: reduced ? `${ROW_BASE_X[r]}%` : x }}
    >
      {row.map((src, c) => (
        <WallTile key={c} src={src} r={r} c={c} loop={loop} reduced={reduced} focusCells={focusCells} />
      ))}
    </motion.div>
  );
}

function WallTile({
  src,
  r,
  c,
  loop,
  reduced,
  focusCells,
}: {
  src: string;
  r: number;
  c: number;
  loop: MotionValue<number>;
  reduced: boolean;
  focusCells: Record<string, number>;
}) {
  const key = `${r}-${c}`;
  const focusOrder = focusCells[key];
  let at: number;
  let dur: number;
  if (focusOrder !== undefined) {
    at = FOCUS_T0 + focusOrder * FOCUS_STEP;
    dur = FOCUS_DUR;
  } else {
    const dist = Math.hypot(r - 1.5, c - 2.5);
    at = FILLER_T0 + dist * FILLER_RING + ((r * 7 + c * 3) % 5) * 0.05;
    dur = FILLER_DUR;
  }
  const opacity = useTransform(loop, [F(at), F(at + dur)], [0, 1]);
  return (
    <motion.div
      className="w-[25.5%] shrink-0 overflow-hidden rounded-lg bg-[var(--tq-card)]"
      style={{ aspectRatio: "16 / 9", opacity: reduced ? 1 : opacity }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative
          deck thumbnails (public/showcase), same native-img convention as
          AuthMarqueeBackground; next/image optimization buys nothing here */}
      <img src={src} alt="" aria-hidden draggable={false} loading="lazy" className="h-full w-full object-cover" />
    </motion.div>
  );
}

const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const SPARK_COLORS = ["#ffffff", "var(--tq-brand-purple)", "var(--tq-brand-blue)", "#8FB8FF"];
function Sparkles({ loop, at }: { loop: MotionValue<number>; at: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {SPARK_ANGLES.map((deg, i) => (
        <Spark key={deg} deg={deg} i={i} loop={loop} at={at + F((i % 3) * 0.08)} />
      ))}
    </div>
  );
}
function Spark({
  deg,
  i,
  loop,
  at,
}: {
  deg: number;
  i: number;
  loop: MotionValue<number>;
  at: number;
}) {
  const dist = 52 + (i % 3) * 14;
  const rad = (deg * Math.PI) / 180;
  const x = useTransform(loop, [at, at + F(0.9)], [0, Math.cos(rad) * dist]);
  const y = useTransform(loop, [at, at + F(0.9)], [0, Math.sin(rad) * dist]);
  const opacity = useTransform(loop, [at, at + F(0.25), at + F(0.9)], [0, 1, 0]);
  const scale = useTransform(loop, [at, at + F(0.3), at + F(0.9)], [0.2, 1, 0.4]);
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 12 12"
      className="absolute left-1/2 top-1/2 -ml-2 -mt-2"
      style={{ x, y, opacity, scale }}
    >
      <path
        d="M6 0 L7.2 4.8 L12 6 L7.2 7.2 L6 12 L4.8 7.2 L0 6 L4.8 4.8 Z"
        fill={SPARK_COLORS[i % SPARK_COLORS.length]}
      />
    </motion.svg>
  );
}
