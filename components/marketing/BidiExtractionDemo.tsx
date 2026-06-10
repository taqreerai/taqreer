"use client";

// ─── BiDi extraction demo ────────────────────────────────────────────────────
// Landing "features" showcase (also rendered in /lab/svg-animations for tuning):
//   • a DARK slide canvas with window chrome (title bar + traffic lights),
//   • violet straight dashed flow-lines centred on the window, with mixed-brand
//     dots streaming IN from both edges (the extraction patches),
//   • an Arabic + English + number sentence whose broken bidi (laid out
//     backwards) reorders into correct RTL via the white تفعيل / إلغاء toggle
//     below the canvas, labelled with the extraction tech.
//   • the whole block reveals on scroll (fade + slide up).
// Tokens only; traffic-light colors are universal OS chrome (matches Hero.tsx).

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SegmentedToggle } from "@/components/create/controls";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

// One sentence, two arrangements of the SAME tokens. WRONG = logical order shown
// left-to-right (Arabic reads backwards, the Latin word + number land wrong).
// FIXED = correct RTL visual order — run order reverses, each run ("Taqreer",
// "95%") stays intact, exactly what proper bidi does.
const TOKENS: Record<string, { t: string; run?: boolean }> = {
  launch: { t: "إطلاق" },
  brand: { t: "taqreer.ai", run: true },
  rate: { t: "بنسبة" },
  success: { t: "نجاح" },
  num: { t: "95%", run: true },
};
const WRONG = ["launch", "brand", "rate", "success", "num"]; // visual L→R (broken)
const FIXED = ["num", "success", "rate", "brand", "launch"]; // visual L→R (correct)

export function BidiExtractionDemo({
  fixed: controlledFixed,
  hideToggle = false,
  align = "center",
}: { fixed?: boolean; hideToggle?: boolean; align?: "center" | "left" | "right" } = {}) {
  const [internalFixed, setInternalFixed] = useState(false);
  const dict = useDict();
  const { dir } = useLocale();
  const b = dict.landing.bidi;
  // Controlled (landing drives `fixed` from the section title) or uncontrolled
  // (the lab uses its own toggle below the canvas).
  const fixed = controlledFixed ?? internalFixed;

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-6">
      <style>{`@keyframes tq-dash-flow { to { stroke-dashoffset: -120; } }`}</style>

      {/* Scene block — flow-lines + the window, both centred, so the lines
          auto-centre on the window (no offset math needed). */}
      <div className="relative aspect-[1000/460] w-full">
        <FlowLines align={align} />

        {/* Slide window. dir=ltr so the chrome (traffic lights left) reads LTR
            while the slide content stays RTL. No shadow. `align` pins it to the
            outer edge: left (RTL chrome) or right (LTR chrome); otherwise
            centred (lab). */}
        <div
          dir="ltr"
          className={`absolute top-1/2 z-10 w-[min(540px,86%)] -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 ${
            align === "left"
              ? "left-0"
              : align === "right"
                ? "right-0"
                : "left-1/2 -translate-x-1/2"
          }`}
        >
          <TitleBar title={b.windowTitle} />

          {/* Transparent slide — only the border + the (kept) title bar; the
              flow-lines behind show through. The slide chrome (header on the
              reading-start edge, pagination on the reading-end edge) follows the
              UI locale: RTL → header right / pagination left, LTR → flipped. */}
          <div className="relative aspect-video w-full overflow-hidden">
            <div className="relative flex h-full flex-col p-6" dir={dir}>
              <div className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-[var(--tq-violet)]" />
                <span className="text-[14px] font-semibold text-white/90">
                  {b.slideHeader}
                </span>
              </div>

              <div className="flex flex-1 items-center justify-center">
                <Sentence fixed={fixed} />
              </div>

              <div className="text-end text-[11px] font-medium tracking-wide text-white/20">
                01 / 12
              </div>
            </div>

            {/* scan-line sweep — wide, soft, fades fully in + out as it crosses */}
            <AnimatePresence>
              <motion.div
                key={fixed ? "f" : "w"}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-1/2"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(var(--tq-violet-rgb),0.12), transparent)",
                }}
                initial={{ x: "-160%", opacity: 0 }}
                animate={{ x: "300%", opacity: [0, 1, 1, 0] }}
                transition={{
                  duration: 1.2,
                  ease: "easeInOut",
                  opacity: { times: [0, 0.2, 0.7, 1] },
                }}
              />
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Lab-only inline toggle (on the landing, the section title drives
          `fixed` instead, so this is hidden via `hideToggle`). */}
      {!hideToggle && (
        <div className="flex items-center gap-4">
          <span className="text-[15px] font-medium text-white/65">
            {b.labLabel}
          </span>
          <SegmentedToggle
            options={[
              { value: "on", label: b.on },
              { value: "off", label: b.off },
            ]}
            value={fixed ? "on" : "off"}
            onChange={(v) => setInternalFixed(v === "on")}
            ariaLabel={b.labAria}
            size="large"
          />
        </div>
      )}
    </div>
  );
}

function TitleBar({ title }: { title: string }) {
  return (
    <div className="relative flex h-11 items-center border-b border-white/[0.06] bg-[var(--tq-card)] px-4">
      {/* macOS traffic lights (universal OS chrome colors, like Hero.tsx). */}
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
      </div>
      <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium text-[var(--tq-text-muted)]">
        {title}
      </span>
      <div className="ml-auto flex items-center gap-3 text-white/25">
        <Glyph d="M4 12h16M4 6h16M4 18h16" />
        <Glyph d="M12 5v14M5 12h14" />
      </div>
    </div>
  );
}

function Sentence({ fixed }: { fixed: boolean }) {
  const order = fixed ? FIXED : WRONG;
  return (
    // dir=ltr so the array order IS the visual L→R order we control.
    <div dir="ltr" className="flex flex-wrap items-center justify-center gap-2">
      {order.map((id) => {
        const tok = TOKENS[id];
        return (
          <motion.span
            key={id}
            layout
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="rounded-lg px-2 py-0.5 text-[22px] leading-snug font-semibold"
            style={
              tok.run
                ? {
                    color: fixed ? "var(--tq-violet)" : "var(--tq-text-muted)",
                    background: fixed
                      ? "rgba(var(--tq-violet-rgb),0.14)"
                      : "transparent",
                    border: fixed
                      ? "1px solid rgba(var(--tq-violet-rgb),0.4)"
                      : "1px dashed rgba(255,255,255,0.2)",
                  }
                : { color: "var(--tq-text-primary)", border: "1px solid transparent" }
            }
          >
            {tok.t}
          </motion.span>
        );
      })}
    </div>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function FlowLines({ align = "center" }: { align?: "center" | "left" | "right" }) {
  // Straight horizontal lines streaming toward the window. Centred layout draws
  // them from both edges; edge-aligned (landing — left in RTL, right in LTR)
  // draws full-width lines that flow across toward the (edge-pinned) window.
  // Mixed brand dots — purple, the two brand-gradient stops, and muted white.
  const DOT_COLORS = [
    "var(--tq-violet)",
    "rgba(255,255,255,0.55)",
    "var(--tq-brand-purple)",
    "var(--tq-brand-blue)",
    "rgba(255,255,255,0.4)",
    "var(--tq-violet)",
  ];

  // Landing (left): 4 lines that ALTERNATE flow direction (rtl ⇄ ltr), each at
  // its OWN speed, with irregularly-spaced dots — reads like bidirectional data
  // transmission. Centred (lab): 6 lines from both edges, even 2-dot stream.
  // `dur` drives both the dash drift + the dot speed; `dots` lists each dot's
  // begin offset (uneven on purpose) — hardcoded (not Math.random) so SSR and
  // client hydration match.
  const LINES =
    align === "left" || align === "right"
      ? [
          { y: 115, dir: "rtl", dur: 6.5, dots: [0, 2.4] },
          { y: 215, dir: "ltr", dur: 10, dots: [0.8, 4.5] },
          { y: 315, dir: "rtl", dur: 8, dots: [0, 5.2] },
          { y: 415, dir: "ltr", dur: 11.5, dots: [1.5, 5.5] },
        ].map((ln) => ({
          // Span the full width so the stream reaches the canvas's left edge.
          d:
            ln.dir === "rtl"
              ? `M1000,${ln.y} L 0,${ln.y}`
              : `M0,${ln.y} L 1000,${ln.y}`,
          dur: ln.dur,
          dots: ln.dots,
        }))
      : [
          "M0,180 L 250,180",
          "M0,230 L 250,230",
          "M0,280 L 250,280",
          "M1000,180 L 750,180",
          "M1000,230 L 750,230",
          "M1000,280 L 750,280",
        ].map((d, i) => {
          const dur = 3 + (i % 3) * 0.5;
          return { d, dur, dots: [0, dur / 2] };
        });

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1000 460"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {LINES.map((ln, i) => (
        <path
          key={`p${i}`}
          id={`tq-flow-${i}`}
          d={ln.d}
          stroke="rgba(var(--tq-violet-rgb),0.16)"
          strokeWidth="1.5"
          strokeDasharray="5 8"
          style={{ animation: `tq-dash-flow ${ln.dur}s linear infinite` }}
        />
      ))}

      {/* crisp dots (no glow) — fade in on enter, fade out on exit, synced with
          each dot's motion. */}
      {LINES.flatMap((ln, i) =>
        ln.dots.map((begin, j) => (
          <circle
            key={`d${i}-${j}`}
            r="4"
            fill={DOT_COLORS[(i + j) % DOT_COLORS.length]}
            opacity="0"
          >
            <animateMotion
              dur={`${ln.dur}s`}
              begin={`${begin}s`}
              repeatCount="indefinite"
            >
              <mpath href={`#tq-flow-${i}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.12;0.88;1"
              dur={`${ln.dur}s`}
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))
      )}
    </svg>
  );
}
