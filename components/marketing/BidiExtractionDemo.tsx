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

// One sentence, two arrangements of the SAME tokens. WRONG = logical order shown
// left-to-right (Arabic reads backwards, the Latin word + number land wrong).
// FIXED = correct RTL visual order — run order reverses, each run ("Taqreer",
// "95%") stays intact, exactly what proper bidi does.
const TOKENS: Record<string, { t: string; run?: boolean }> = {
  launch: { t: "إطلاق" },
  brand: { t: "Taqreer", run: true },
  rate: { t: "بنسبة" },
  success: { t: "نجاح" },
  num: { t: "95%", run: true },
};
const WRONG = ["launch", "brand", "rate", "success", "num"]; // visual L→R (broken)
const FIXED = ["num", "success", "rate", "brand", "launch"]; // visual L→R (correct)

export function BidiExtractionDemo() {
  const [fixed, setFixed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-6"
    >
      <style>{`@keyframes tq-dash-flow { to { stroke-dashoffset: -120; } }`}</style>

      {/* Scene block — flow-lines + the window, both centred, so the lines
          auto-centre on the window (no offset math needed). */}
      <div className="relative aspect-[1000/460] w-full">
        <FlowLines />

        {/* Slide window. dir=ltr so the chrome (traffic lights left) reads LTR
            while the slide content stays RTL. No shadow. */}
        <div
          dir="ltr"
          className="absolute top-1/2 left-1/2 z-10 w-[min(540px,86%)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#161616]"
        >
          <TitleBar />

          {/* The dark slide. */}
          <div className="relative aspect-video w-full overflow-hidden bg-[#1b1b1e]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
              style={{
                background:
                  "radial-gradient(120% 100% at 50% 140%, rgba(139,92,246,0.16), transparent 70%)",
              }}
            />
            <div className="relative flex h-full flex-col p-6" dir="rtl">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-[var(--tq-violet)]" />
                <span className="text-[14px] font-semibold text-white/90">
                  أداء الربع الأول
                </span>
              </div>

              <div className="flex flex-1 items-center justify-center">
                <Sentence fixed={fixed} />
              </div>

              <div className="text-left text-[11px] font-medium tracking-wide text-white/20">
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
                    "linear-gradient(90deg, transparent, rgba(139,92,246,0.12), transparent)",
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

      {/* Extraction-tech label + the enable/disable toggle, below the canvas. */}
      <div dir="rtl" className="flex items-center gap-4">
        <span className="text-[15px] font-medium text-white/65">
          تقنية Taqreer لتحسين الاستخراج
        </span>
        <SegmentedToggle
          options={[
            { value: "on", label: "تفعيل" },
            { value: "off", label: "إلغاء" },
          ]}
          value={fixed ? "on" : "off"}
          onChange={(v) => setFixed(v === "on")}
          ariaLabel="تقنية الاستخراج"
          size="large"
        />
      </div>
    </motion.div>
  );
}

function TitleBar() {
  return (
    <div className="relative flex h-11 items-center border-b border-white/[0.06] bg-[#1c1c1e] px-4">
      {/* macOS traffic lights (universal OS chrome colors, like Hero.tsx). */}
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
      </div>
      <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium text-[var(--tq-text-muted)]">
        تقرير الربع الأول — Taqreer
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
                    color: fixed ? "var(--tq-violet)" : "#6b7280",
                    background: fixed ? "rgba(139,92,246,0.14)" : "transparent",
                    border: fixed
                      ? "1px solid rgba(139,92,246,0.4)"
                      : "1px dashed rgba(255,255,255,0.2)",
                  }
                : { color: "#f3f4f6", border: "1px solid transparent" }
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

function FlowLines() {
  // Straight horizontal lines centred on the window (scene centre = viewBox 230).
  // Static (independent of the toggle) so flipping never restarts the dots.
  const PATHS = [
    "M0,180 L 250,180",
    "M0,230 L 250,230",
    "M0,280 L 250,280",
    "M1000,180 L 750,180",
    "M1000,230 L 750,230",
    "M1000,280 L 750,280",
  ];
  // Mixed brand dots — purple, the two brand-gradient stops, and muted white.
  const DOT_COLORS = [
    "var(--tq-violet)",
    "rgba(255,255,255,0.55)",
    "#7D2DFF",
    "#370BF4",
    "rgba(255,255,255,0.4)",
    "var(--tq-violet)",
  ];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1000 460"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {PATHS.map((d, i) => (
        <path
          key={`p${i}`}
          id={`tq-flow-${i}`}
          d={d}
          stroke="rgba(139,92,246,0.16)"
          strokeWidth="1.5"
          strokeDasharray="5 8"
          style={{ animation: `tq-dash-flow ${3 + (i % 3) * 0.5}s linear infinite` }}
        />
      ))}

      {/* crisp dots (no glow) streaming along the lines */}
      {PATHS.map((d, i) => (
        <circle key={`d${i}`} r="4" fill={DOT_COLORS[i % DOT_COLORS.length]}>
          <animateMotion
            dur={`${3 + (i % 3) * 0.5}s`}
            begin={`${i * 0.4}s`}
            repeatCount="indefinite"
          >
            <mpath href={`#tq-flow-${i}`} />
          </animateMotion>
        </circle>
      ))}
    </svg>
  );
}
